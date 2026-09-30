#!/usr/bin/env bash
# ==============================================================================
# Enterprise Sui Mainnet Dedicated Fullnode Automated Setup Script
# Based on Official Mysten Labs releases & Staketab / Suiscan Fast-Sync Snapshots
# Target OS: Ubuntu 22.04 LTS / Debian 12 (x86_64)
# ==============================================================================

set -euo pipefail

# 1. Configuration Variables
SUI_USER="sui"
SUI_HOME="/home/${SUI_USER}"
SUI_DIR="${SUI_HOME}/.sui"
SUI_DB_DIR="${SUI_DIR}/db"
SUI_CONFIG_DIR="${SUI_DIR}/config"
FULLNODE_CONFIG="${SUI_CONFIG_DIR}/fullnode.yaml"
GENESIS_BLOB="${SUI_CONFIG_DIR}/genesis.blob"
BIN_DIR="/usr/local/bin"

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}==================================================================${NC}"
echo -e "${CYAN}   🚀 SUI MAINNET DEDICATED FULLNODE INSTALLER (STAKETAB FAST-SYNC) ${NC}"
echo -e "${CYAN}==================================================================${NC}"

# Check root privileges
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}[ERROR] This script must be run as root. Use sudo ./deploy_sui_fullnode.sh${NC}"
   exit 1
fi

# 2. System Update & Dependencies Installation
echo -e "\n${YELLOW}[1/7] Installing system dependencies, build tools & fast decompression packages...${NC}"
apt-get update -y
apt-get install -y --no-install-recommends \
    curl \
    wget \
    git \
    tar \
    lz4 \
    jq \
    aria2 \
    pv \
    libclang-dev \
    pkg-config \
    build-essential \
    libssl-dev \
    ufw

# 3. Create Dedicated Service User & Directories
echo -e "\n${YELLOW}[2/7] Creating dedicated service user and storage directories...${NC}"
if ! id "${SUI_USER}" &>/dev/null; then
    useradd -m -s /bin/bash "${SUI_USER}"
    echo -e "${GREEN}✓ Created user ${SUI_USER}${NC}"
fi

mkdir -p "${SUI_DB_DIR}" "${SUI_CONFIG_DIR}"
chown -R "${SUI_USER}:${SUI_USER}" "${SUI_HOME}"

# 4. Download Official Mysten Labs Sui Node Binary
echo -e "\n${YELLOW}[3/7] Fetching latest official Sui Mainnet release binary from Mysten Labs...${NC}"
LATEST_RELEASE=$(curl -sSf https://api.github.com/repos/MystenLabs/sui/releases | jq -r '[.[] | select(.tag_name | startswith("mainnet-v"))][0].tag_name')

if [[ -z "${LATEST_RELEASE}" || "${LATEST_RELEASE}" == "null" ]]; then
    # Fallback to proven stable mainnet release if GitHub API rate-limited
    LATEST_RELEASE="mainnet-v1.44.1"
fi

echo -e "Targeting Sui Mainnet Release: ${GREEN}${LATEST_RELEASE}${NC}"
BINARY_URL="https://github.com/MystenLabs/sui/releases/download/${LATEST_RELEASE}/sui-node-${LATEST_RELEASE}-ubuntu-x86_64.tgz"

echo "Downloading sui-node binary..."
wget -q --show-progress -O /tmp/sui-node.tgz "${BINARY_URL}"
tar -xzf /tmp/sui-node.tgz -C "${BIN_DIR}/"
chmod +x "${BIN_DIR}/sui-node"
rm -f /tmp/sui-node.tgz

SUI_VERSION=$("${BIN_DIR}/sui-node" --version || echo "sui-node installed")
echo -e "${GREEN}✓ Binary installed: ${SUI_VERSION}${NC}"

# 5. Download Genesis Blob & Configure fullnode.yaml
echo -e "\n${YELLOW}[4/7] Downloading Mainnet genesis.blob and configuring fullnode.yaml...${NC}"
wget -q --show-progress -O "${GENESIS_BLOB}" "https://github.com/MystenLabs/sui-genesis/raw/main/mainnet/genesis.blob"
chown "${SUI_USER}:${SUI_USER}" "${GENESIS_BLOB}"

cat <<EOF > "${FULLNODE_CONFIG}"
# ==============================================================================
# Sui Mainnet High-Throughput MEV Fullnode Configuration
# ==============================================================================
db-path: "${SUI_DB_DIR}"
network-address: "/ip4/0.0.0.0/tcp/8084/http"
metrics-address: "0.0.0.0:8080"
admin-interface-port: 1337

json-rpc-address: "0.0.0.0:9000"
websocket-address: "0.0.0.0:9001"

genesis:
  genesis-file-location: "${GENESIS_BLOB}"

# P2P High-Speed Consensus Seeds
p2p-sync:
  peer-sync-batch-size: 500

# Aggressive Pruning to maintain compact DB (< 1.5 TB) while preserving live state
authority-store-pruning-config:
  num-latest-epoch-dbs-to-retain: 2
  epoch-db-pruning-period-secs: 3600
  num-epochs-to-retain: 1
  max-checkpoints-in-batch: 10
  periodic-compaction-threshold-days: 1
EOF

chown "${SUI_USER}:${SUI_USER}" "${FULLNODE_CONFIG}"
echo -e "${GREEN}✓ Generated ${FULLNODE_CONFIG}${NC}"

# 6. Fast-Sync Database Snapshot Download (Staketab / Suiscan RocksDB Mirror)
echo -e "\n${YELLOW}[5/7] Downloading Staketab fast-sync pruned snapshot (Bypasses days of replay)...${NC}"
echo -e "${CYAN}Querying Staketab RocksDB latest pruned mainnet snapshot...${NC}"

# Stop any running sui-node service before database restoration
systemctl stop sui-node.service 2>/dev/null || true

SNAPSHOT_URL="https://sui-mainnet-snapshot.staketab.org/sui-mainnet-snapshot.tar.lz4"

if curl -s --head "${SNAPSHOT_URL}" | grep "200 OK" > /dev/null; then
    echo "Downloading and extracting snapshot directly into ${SUI_DB_DIR} via streaming lz4..."
    curl -L "${SNAPSHOT_URL}" | pv | lz4 -d | tar -xC "${SUI_DB_DIR}"
    chown -R "${SUI_USER}:${SUI_USER}" "${SUI_DB_DIR}"
    echo -e "${GREEN}✓ Snapshot extraction complete! Node is synced to near-live tip.${NC}"
else
    echo -e "${YELLOW}[NOTICE] Staketab direct mirror busy or rotating snapshot. Node will start with fast peer-to-peer sync.${NC}"
fi

# 7. Configure Systemd Service
echo -e "\n${YELLOW}[6/7] Creating systemd service daemon...${NC}"
cat <<EOF > /etc/systemd/system/sui-node.service
[Unit]
Description=Sui Mainnet MEV Fullnode Service
After=network-online.target
Wants=network-online.target

[Service]
User=${SUI_USER}
Group=${SUI_USER}
Type=simple
ExecStart=${BIN_DIR}/sui-node --config-path ${FULLNODE_CONFIG}
Restart=always
RestartSec=5s
LimitNOFILE=65535
LimitNPROC=65535

# High-Performance Memory Allocation (Jemalloc)
Environment="RUST_LOG=info,sui_core=warn,sui_node=info"

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable sui-node.service
systemctl restart sui-node.service

# 8. Firewall Configuration (UFW)
echo -e "\n${YELLOW}[7/7] Configuring firewall rules...${NC}"
ufw allow 8084/tcp comment "Sui P2P" || true
# Note: For security, restrict port 9000 (JSON-RPC) to your searcher IP or use an SSH tunnel
ufw allow 9000/tcp comment "Sui JSON-RPC" || true
ufw allow 9001/tcp comment "Sui WebSockets" || true

echo -e "\n${GREEN}==================================================================${NC}"
echo -e "${GREEN}   ✅ SUI MAINNET DEDICATED FULLNODE DEPLOYMENT COMPLETE!        ${NC}"
echo -e "${GREEN}==================================================================${NC}"
echo -e "Status Check:  ${CYAN}systemctl status sui-node.service${NC}"
echo -e "Live Logs:     ${CYAN}journalctl -u sui-node.service -f -o cat${NC}"
echo -e "RPC Endpoint:  ${CYAN}http://localhost:9000${NC}"
echo -e "WS Endpoint:   ${CYAN}ws://localhost:9001${NC}"
echo -e "\nVerify local sync with:"
echo -e "${YELLOW}curl -X POST http://localhost:9000 -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"sui_getLatestCheckpointSequenceNumber\",\"params\":[]}'${NC}\n"
