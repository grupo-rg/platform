import json
from pathlib import Path

def print_comparison():
    ai_file = Path(r"c:\Users\Usuario\Documents\github\works\nexoai\data_extraction_lab\mu02_ai_generated.json")
    human_file = Path(r"c:\Users\Usuario\Documents\github\works\nexoai\data_extraction_lab\mu02_human_baseline.json")
    
    with open(ai_file, "r", encoding="utf-8") as f:
        ai_data = json.load(f)
        
    with open(human_file, "r", encoding="utf-8") as f:
        human_data = json.load(f)
        
    ai_total = ai_data.get("costBreakdown", {}).get("total", 0.0)
    
    # Calculate human total
    human_total = 0.0
    human_items = {}
    for ch in human_data.get("chapters", []):
        for it in ch.get("items", []):
            cost = it.get("total_price", 0.0)
            human_total += cost
            human_items[it.get("code")] = cost
            
    # Compile AI items
    ai_items = {}
    for ch in ai_data.get("chapters", []):
        for it in ch.get("items", []):
            cost = it.get("budgetPrice", 0.0)
            ai_items[it.get("code")] = cost

    print("=== SUMMARY ===")
    print(f"Human Total: {human_total:.2f} €")
    print(f"AI Total: {ai_total:.2f} €")
    
    diff = ai_total - human_total
    perc = (diff / human_total) * 100 if human_total else 0
    print(f"Variance: {diff:.2f} € ({perc:.2f}%)\n")

    print("=== HIGHEST VARIANCES BY ITEM (Top 10) ===")
    variances = []
    
    for code, h_cost in human_items.items():
        if code in ai_items:
            a_cost = ai_items[code]
            v = abs(a_cost - h_cost)
            variances.append((code, h_cost, a_cost, v))
            
    variances.sort(key=lambda x: x[3], reverse=True)
    
    for v in variances[:10]:
        print(f"Item {v[0]}: Human: {v[1]:.2f} - AI: {v[2]:.2f} | Error: {v[3]:.2f}")

if __name__ == "__main__":
    print_comparison()
