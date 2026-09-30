import json
import os
import sys
import matplotlib
matplotlib.use('Agg')

def verify_notebook():
    nb_path = os.path.join(os.getcwd(), 'notebooks', 'sui_mev_architecture_guide.ipynb')
    with open(nb_path, 'r', encoding='utf-8') as f:
        nb = json.load(f)

    def mock_display(obj):
        print(f"[DISPLAY OUTPUT]:\n{obj}\n", flush=True)

    global_env = {
        'display': mock_display,
        '__name__': '__main__',
    }

    code_cells = [c for c in nb['cells'] if c['cell_type'] == 'code']
    print(f"Total code cells to verify: {len(code_cells)}", flush=True)

    for idx, cell in enumerate(code_cells, 1):
        source = "".join(cell['source'])
        print(f"\n--- Executing Code Cell {idx} ---", flush=True)
        try:
            exec(source, global_env)
            print(f"[PASSED] Cell {idx}", flush=True)
        except Exception as e:
            print(f"[FAILED] Cell {idx} with error: {e}", file=sys.stderr, flush=True)
            raise e

    print("\n[ALL CELLS PASSED SUCCESSFULLY]", flush=True)

if __name__ == '__main__':
    verify_notebook()
