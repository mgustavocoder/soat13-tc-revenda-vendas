/**
 * Regra de negócio violada pelo estado atual do recurso (ex.: transição de
 * status não permitida).
 */
class BusinessRuleError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BusinessRuleError'
  }
}

export { BusinessRuleError }
