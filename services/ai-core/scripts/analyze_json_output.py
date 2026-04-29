import json
from collections import Counter

def analyze_json(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    print("=== ANALYSIS OF BUDGET JSON ===")
    
    null_candidates = []
    item_codes = []
    item_ids = []
    duplicate_items = []
    total_items = 0

    for chapter in data.get("chapters", []):
        chapter_name = chapter.get("name", "Unknown")
        print(f"\nScanning Chapter: {chapter_name}")
        
        for item in chapter.get("items", []):
            total_items += 1
            code = item.get("code")
            item_id = item.get("id")
            
            item_codes.append(code)
            item_ids.append(item_id)
            
            ai_res = item.get("ai_resolution", {})
            if ai_res.get("selected_candidate") is None:
                null_candidates.append(code)

    print(f"\nTotal Items Processed: {total_items}")
    
    # Check for duplicate codes (excluding potential empty codes)
    valid_codes = [c for c in item_codes if c]
    code_counts = Counter(valid_codes)
    duplicates = {code: count for code, count in code_counts.items() if count > 1}
    
    if duplicates:
        print("\n⚠️ DUPLICATE ITEM CODES FOUND:")
        for code, count in duplicates.items():
            print(f"   - Code {code}: occurs {count} times")
    else:
        print("\n✅ No duplicate item codes found.")

    # Check for null candidates
    if null_candidates:
        print(f"\n⚠️ ITEMS WITH NULL SELECTED_CANDIDATE ({len(null_candidates)}):")
        for code in null_candidates:
            print(f"   - Code {code}")
    else:
        print("\n✅ All items have a selected candidate.")

if __name__ == "__main__":
    analyze_json("../../data_extraction_lab/docs-to-analisys/e2e_budget_output.json")
