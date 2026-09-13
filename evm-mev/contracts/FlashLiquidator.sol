// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Minimal ERC20 Interface
 */
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

/**
 * @title Balancer Vault Flash Loan Interface (0% fee)
 */
interface IBalancerVault {
    function flashLoan(
        address recipient,
        IERC20[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external;
}

/**
 * @title Aave v3 Pool Interface (Flash Loan & Liquidation)
 */
interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes memory params,
        uint16 referralCode
    ) external;

    function liquidationCall(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        bool receiveAToken
    ) external;
}

/**
 * @title Uniswap v3 / DragonSwap Swap Router
 */
interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/**
 * @title FlashLiquidator
 * @notice Zero-capital atomic liquidation engine on EVM (Monad / Sei v2).
 * Atomically routes: [Flash Loan Borrow] -> [Lending Liquidation] -> [DEX Atomic Swap] -> [Flash Loan Repay] -> [Profit Transfer]
 */
contract FlashLiquidator {
    address public immutable owner;
    IBalancerVault public immutable balancerVault;
    IPool public immutable aavePool;
    ISwapRouter public immutable swapRouter;

    struct LiquidationParams {
        address lendingPool;     // Target protocol (Aave v3 / Yei Finance)
        address borrower;        // Undercollateralized borrower address
        address debtAsset;       // Asset borrowed (to be flash loaned & repaid)
        address collateralAsset; // Asset to be seized
        uint256 debtToCover;     // Repayment amount
        uint24 swapPoolFee;      // Uniswap v3 fee tier (e.g., 500 = 0.05%, 3000 = 0.3%)
        uint256 minProfit;       // Minimum required profit to prevent unprofitable execution
    }

    event LiquidationExecuted(
        address indexed borrower,
        address indexed debtAsset,
        address indexed collateralAsset,
        uint256 debtRepaid,
        uint256 profitGenerated
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor(
        address _balancerVault,
        address _aavePool,
        address _swapRouter
    ) {
        owner = msg.sender;
        balancerVault = IBalancerVault(_balancerVault);
        aavePool = IPool(_aavePool);
        swapRouter = ISwapRouter(_swapRouter);
    }

    /**
     * @notice Execute zero-capital liquidation via Balancer Flash Loan (0% fee)
     */
    function executeViaBalancer(LiquidationParams calldata params) external onlyOwner {
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = IERC20(params.debtAsset);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = params.debtToCover;

        bytes memory userData = abi.encode(params);
        balancerVault.flashLoan(address(this), tokens, amounts, userData);
    }

    /**
     * @notice Balancer Flash Loan Callback
     */
    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external {
        require(msg.sender == address(balancerVault), "Unauthorized callback");

        LiquidationParams memory params = abi.decode(userData, (LiquidationParams));
        uint256 debtToCover = amounts[0];
        uint256 fee = feeAmounts[0];
        uint256 totalRepay = debtToCover + fee;

        _executeCoreLiquidation(params);

        // Repay Flash Loan
        tokens[0].transfer(address(balancerVault), totalRepay);

        // Send net profit to operator
        uint256 remainingProfit = tokens[0].balanceOf(address(this));
        require(remainingProfit >= params.minProfit, "Insufficient profit");

        if (remainingProfit > 0) {
            tokens[0].transfer(owner, remainingProfit);
        }

        emit LiquidationExecuted(
            params.borrower,
            params.debtAsset,
            params.collateralAsset,
            debtToCover,
            remainingProfit
        );
    }

    /**
     * @notice Execute zero-capital liquidation via Aave v3 Flash Loan Simple
     */
    function executeViaAave(LiquidationParams calldata params) external onlyOwner {
        bytes memory data = abi.encode(params);
        aavePool.flashLoanSimple(
            address(this),
            params.debtAsset,
            params.debtToCover,
            data,
            0
        );
    }

    /**
     * @notice Aave v3 Flash Loan Callback
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata paramsBytes
    ) external returns (bool) {
        require(msg.sender == address(aavePool), "Unauthorized callback");
        require(initiator == address(this), "Unauthorized initiator");

        LiquidationParams memory params = abi.decode(paramsBytes, (LiquidationParams));
        uint256 totalRepay = amount + premium;

        _executeCoreLiquidation(params);

        // Approve Aave Pool to pull repayment
        IERC20(asset).approve(address(aavePool), totalRepay);

        // Sweep profit to operator
        uint256 remainingProfit = IERC20(asset).balanceOf(address(this));
        require(remainingProfit >= params.minProfit, "Insufficient profit");

        if (remainingProfit > 0) {
            IERC20(asset).transfer(owner, remainingProfit);
        }

        emit LiquidationExecuted(
            params.borrower,
            params.debtAsset,
            params.collateralAsset,
            amount,
            remainingProfit
        );

        return true;
    }

    /**
     * @dev Internal atomic liquidation & DEX swap routine
     */
    function _executeCoreLiquidation(LiquidationParams memory params) internal {
        // 1. Approve Lending Pool to spend borrowed debt token
        IERC20(params.debtAsset).approve(params.lendingPool, params.debtToCover);

        // 2. Liquidate undercollateralized borrower
        IPool(params.lendingPool).liquidationCall(
            params.collateralAsset,
            params.debtAsset,
            params.borrower,
            params.debtToCover,
            false // Receive underlying token, not aToken
        );

        // 3. Swap seized collateral token -> debt token on DEX
        uint256 seizedBalance = IERC20(params.collateralAsset).balanceOf(address(this));
        if (params.collateralAsset != params.debtAsset && seizedBalance > 0) {
            IERC20(params.collateralAsset).approve(address(swapRouter), seizedBalance);

            swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: params.collateralAsset,
                    tokenOut: params.debtAsset,
                    fee: params.swapPoolFee,
                    recipient: address(this),
                    amountIn: seizedBalance,
                    amountOutMinimum: 0, // Enforced by minProfit check at end
                    sqrtPriceLimitX96: 0
                })
            );
        }
    }

    /**
     * @notice Emergency sweep for rescue
     */
    function emergencyWithdraw(address token) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) {
            IERC20(token).transfer(owner, bal);
        }
    }
}
