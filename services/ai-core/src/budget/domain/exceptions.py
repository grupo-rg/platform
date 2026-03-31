class DomainException(Exception):
    """Base class for all Domain exceptions."""
    pass

class MathematicalValidationError(DomainException):
    """Raised when the calculated sum inside the Budget aggregate does not match."""
    pass

class UnitIncompatibleError(DomainException):
    """Raised when attempting to add incompatible units in a Budget Breakdown."""
    pass

class AIProviderError(DomainException):
    """Raised when the infrastructure AI adapter completely fails after all retries."""
    pass
