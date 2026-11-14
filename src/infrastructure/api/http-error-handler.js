import { ServiceUnavailableError } from '../../application/errors/service-unavailable-error.js'
import { BusinessRuleError } from '../../domain/errors/business-rule-error.js'
import { DuplicateResourceError } from '../../domain/errors/duplicate-resource-error.js'
import { InvalidInputError } from '../../domain/errors/invalid-input-error.js'
import { ResourceNotFoundError } from '../../domain/errors/resource-not-found-error.js'

const createHttpErrorHandler = ({ logger }) => (error, req, res, next) => {
  if (error instanceof InvalidInputError) return res.status(400).json({ message: error.message })
  if (error instanceof ResourceNotFoundError) return res.status(404).json({ message: error.message })
  if (error instanceof DuplicateResourceError) return res.status(409).json({ message: error.message })
  if (error instanceof BusinessRuleError) return res.status(409).json({ message: error.message })
  if (error instanceof ServiceUnavailableError) return res.status(503).json({ message: error.message })
  if (error?.type === 'entity.parse.failed') return res.status(400).json({ message: 'JSON inválido.' })
  logger.error('Falha no serviço de vendas:', error)
  return res.status(500).json({ message: 'Erro interno no serviço de vendas.' })
}

export { createHttpErrorHandler }
