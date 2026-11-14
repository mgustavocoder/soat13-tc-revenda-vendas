/**
 * Porta de persistência de vendas. A implementação concreta fica na camada de
 * infraestrutura e deve retornar entidades `Venda`.
 */
class VendaRepository {
  async listar() {
    throw new Error('Method listar() must be implemented')
  }

  async buscarPorCodigo() {
    throw new Error('Method buscarPorCodigo() must be implemented')
  }

  /**
   * Deve lançar DuplicateResourceError quando já houver venda ativa para o
   * mesmo veículo.
   */
  async criar() {
    throw new Error('Method criar(venda) must be implemented')
  }

  /**
   * Grava o estado da venda com controle otimista: só atualiza se o status
   * persistido ainda for `statusAnterior`. Retorna `true` quando gravou.
   */
  async atualizar() {
    throw new Error('Method atualizar(venda, statusAnterior) must be implemented')
  }
}

export { VendaRepository }
