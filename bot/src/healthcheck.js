// O loop principal atualiza este marcador depois de cada long-poll bem-sucedido.
// Cinco minutos toleram uma transcrição + extração lentas sem mascarar um loop travado.
import fs from 'node:fs';

const file = process.env.HEALTHCHECK_FILE || '/tmp/financeiro-casal-bot.healthy';
try {
  const ageMs = Date.now() - fs.statSync(file).mtimeMs;
  process.exit(ageMs <= 5 * 60 * 1000 ? 0 : 1);
} catch {
  process.exit(1);
}
