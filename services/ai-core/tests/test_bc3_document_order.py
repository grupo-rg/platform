"""Regresión: el presupuesto respeta el orden del documento BC3 (capítulos y partidas).

Presto exporta los `~C` ordenados por código y los `~D` citan a los hijos sin el
marcador '#'. Antes el conversor seguía el orden de `~C` (alfabético) y el
ensamblado agrupaba por orden de resolución del swarm.
"""
from src.budget.application.use_cases.restructure_budget_uc import _sort_by_source_order
from src.budget.bc3_parser import Bc3Parser, bc3_tree_to_restructured_items
from src.budget.domain.entities import BudgetPartida, OriginalItem

BC3 = "\r\n".join([
    "~V|RIB Spain|FIEBDC-3/2020|Presto 25.01||ANSI||2||||",
    "~C|AAA|ud|PARTIDA A|0|110226|0|",
    "~C|DOC##||OBRA|0|110226|0|",
    "~D|DOC##|TOP\\1\\1\\|",
    "~C|MMM|ud|PARTIDA M|0|110226|0|",
    "~C|TOP#||INSTALACIONES|0|110226|0|",
    "~D|TOP#|CAP2\\1\\1\\CAP1\\1\\1\\|",
    "~C|CAP1#||PRIMER CAPITULO|0|110226|0|",
    "~D|CAP1#|ZZZ\\1\\2\\AAA\\1\\3\\|",
    "~C|CAP2#||SEGUNDO CAPITULO|0|110226|0|",
    "~D|CAP2#|MMM\\1\\1\\|",
    "~C|ZZZ|ud|PARTIDA Z|0|110226|0|",
    "~M|CAP1\\ZZZ|1\\1\\1\\|2|\\\\2\\\\\\\\|",
    "~M|CAP1\\AAA|1\\1\\2\\|3|\\\\3\\\\\\\\|",
    "~M|CAP2\\MMM|1\\2\\1\\|1|\\\\1\\\\\\\\|",
    "",
]).encode("latin-1")


def test_items_follow_document_tree_order():
    items = bc3_tree_to_restructured_items(Bc3Parser().parse(BC3))
    assert [it.code for it in items] == ["MMM", "ZZZ", "AAA"]
    assert [it.chapter.split()[0] for it in items] == ["CAP2", "CAP1", "CAP1"]


def _partida(code: str, chapter: str, order: int) -> BudgetPartida:
    return BudgetPartida(
        id=code, order=order, code=code, description=code, unit="ud", quantity=1.0,
        unitPrice=1.0, totalPrice=1.0, isRealCost=False, matchConfidence=40,
        original_item=OriginalItem(code=code, description=code, quantity=1.0, unit="ud", chapter=chapter, raw_table_data=""),
    )


def test_partidas_sorted_back_to_source_order_and_renumbered():
    source = bc3_tree_to_restructured_items(Bc3Parser().parse(BC3))
    resolved = [_partida("AAA", source[2].chapter, 7), _partida("MMM", source[0].chapter, 3), _partida("ZZZ", source[1].chapter, 1)]
    ordered = _sort_by_source_order(resolved, source)
    assert [p.code for p in ordered] == ["MMM", "ZZZ", "AAA"]
    assert [p.order for p in ordered] == [1, 2, 3]
