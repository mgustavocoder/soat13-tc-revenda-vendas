/**
 * Porta de consulta ao serviço de clientes.
 * `buscarPorCpf` retorna `{ id, nome, cpf, email }` ou `null` quando o cliente
 * não existir; lança ServiceUnavailableError se o serviço estiver fora do ar.
 */
class ClientesGateway {
  async buscarPorCpf() {
    throw new Error('Method buscarPorCpf(cpf) must be implemented')
  }
}

export { ClientesGateway }
