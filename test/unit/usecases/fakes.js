import { Venda } from '../../../src/domain/entities/venda.js'

const silentLogger = { info() {}, warn() {}, error() {} }

const makeRepository = (initial = []) => {
  const rows = new Map(initial.map(venda => [venda.codigo, { ...venda }]))
  return {
    rows,
    async listar() { return [...rows.values()].map(row => new Venda(row)) },
    async buscarPorCodigo(codigo) {
      const row = rows.get(codigo)
      return row ? new Venda({ ...row }) : undefined
    },
    async criar(venda) {
      rows.set(venda.codigo, { ...venda, dataVenda: '2026-11-14T00:00:00.000Z' })
      return venda
    },
    async atualizar(venda, statusAnterior) {
      const row = rows.get(venda.codigo)
      if (!row || row.status !== statusAnterior) return false
      rows.set(venda.codigo, { ...row, ...venda, dataVenda: row.dataVenda })
      return true
    }
  }
}

const makePublisher = ({ fail = false } = {}) => ({
  events: [],
  async publicar(tipo, payload) {
    if (fail) throw new Error('queue down')
    this.events.push({ tipo, ...payload })
  }
})

const vendaExistente = (overrides = {}) => new Venda({
  codigo: 'VEN-1234ABCD',
  veiculoPlaca: 'ABC1D23',
  clienteCpf: '12345678901',
  clienteId: 8,
  status: 'AGUARDANDO_PAGAMENTO',
  ...overrides
})

export { makePublisher, makeRepository, silentLogger, vendaExistente }
