/**
 * Dependência externa (serviço HTTP, fila de eventos) indisponível.
 */
class ServiceUnavailableError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause })
    this.name = 'ServiceUnavailableError'
  }
}

export { ServiceUnavailableError }
