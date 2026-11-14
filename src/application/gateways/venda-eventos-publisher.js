/**
 * Eventos de domínio publicados por vendas na fila `vendas-eventos`.
 * O serviço de veículos reage a eles; vendas não chama veículos diretamente.
 */
const EventosVenda = Object.freeze({
  VENDA_CRIADA: 'VENDA_CRIADA',
  PAGAMENTO_RECEBIDO: 'PAGAMENTO_RECEBIDO',
  VENDA_CANCELADA: 'VENDA_CANCELADA'
})

/**
 * Porta de saída de eventos. Implementações devem lançar
 * ServiceUnavailableError quando a publicação falhar.
 */
class VendaEventosPublisher {
  async publicar() {
    throw new Error('Method publicar(tipo, payload) must be implemented')
  }
}

export { EventosVenda, VendaEventosPublisher }
