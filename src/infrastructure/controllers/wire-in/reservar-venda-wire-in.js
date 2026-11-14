class ReservarVendaWireIn {
  /** Aceita `placa` como alias legado de `veiculoPlaca`. */
  static fromRequest(body) {
    const dados = body && typeof body === 'object' ? body : {}
    return {
      veiculoPlaca: dados.veiculoPlaca ?? dados.placa,
      clienteCpf: dados.clienteCpf
    }
  }
}

export { ReservarVendaWireIn }
