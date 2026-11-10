import 'dotenv/config'
import { createApp } from './app.js'

const port = Number(process.env.VENDAS_PORT || 3003)
const app = createApp()
app.listen(port, '0.0.0.0', () => {
  console.info(`Serviço de vendas disponível na porta ${port}`)
})
