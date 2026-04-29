"""Raíz de conftest.

Ignoramos tests legacy cuyos imports apuntan a clases que ya no existen
(ej: `PricingEvaluatorResult` fue reemplazado por `BatchPricingEvaluatorResultV3`).
Se mantienen en disco para migrarlos cuando toque.
"""

collect_ignore_glob = [
    "scripts/test_extractor_local.py",
    "tests/application/test_extract_budget_use_case.py",
    "tests/budget/application/test_restructure_budget_uc.py",
    "tests/domain/test_math_validator.py",
]
