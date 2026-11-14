import { ClientesGateway } from '../../application/gateways/clientes-gateway.js'
import { ServiceUnavailableError } from '../../application/errors/service-unavailable-error.js'

const TIMEOUT_MS = 10000

/**
 * Consulta síncrona ao serviço de clientes. É uma leitura (não altera estado),
 * por isso não participa da saga: valida o cliente antes de a saga começar.
 */
class ClientesHttpGateway extends ClientesGateway {
  constructor({ baseUrl, fetchImpl = globalThis.fetch }) {
    super()
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.fetchImpl = fetchImpl
  }

  async buscarPorCpf(cpf) {
    let response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/internal/clientes/${encodeURIComponent(cpf)}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
    } catch (cause) {
      throw new ServiceUnavailableError('Serviço de clientes indisponível.', { cause })
    }

    if (response.status === 404) return null
    if (!response.ok) {
      throw new ServiceUnavailableError(`Falha ao consultar o serviço de clientes (HTTP ${response.status}).`)
    }
    try {
      return await response.json()
    } catch (cause) {
      throw new ServiceUnavailableError('Resposta inválida do serviço de clientes.', { cause })
    }
  }
}

export { ClientesHttpGateway }
