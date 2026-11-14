import { ReservarVendaWireIn } from './wire-in/reservar-venda-wire-in.js'

const comStatusUrl = (venda) => ({ ...venda.toPublic(), statusUrl: `/api/vendas/${venda.codigo}` })

class VendaController {
  constructor(vendaUsecase) {
    this.vendaUsecase = vendaUsecase
  }

  async listar(req, res) {
    const vendas = await this.vendaUsecase.listar()
    res.status(200).json(vendas.map(venda => venda.toPublic()))
  }

  async buscarPorCodigo(req, res) {
    const venda = await this.vendaUsecase.buscarPorCodigo(req.params.codigo)
    res.status(200).json(venda.toPublic())
  }

  async reservar(req, res) {
    const venda = await this.vendaUsecase.reservar(ReservarVendaWireIn.fromRequest(req.body))
    res.status(202).json(comStatusUrl(venda))
  }

  async confirmarPagamento(req, res) {
    const venda = await this.vendaUsecase.confirmarPagamento(req.params.codigo)
    res.status(202).json(comStatusUrl(venda))
  }

  async cancelar(req, res) {
    const venda = await this.vendaUsecase.cancelar(req.params.codigo)
    res.status(200).json(venda.toPublic())
  }
}

export { VendaController }
