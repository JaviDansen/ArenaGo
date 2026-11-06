import { Module, type INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DatabaseModule } from "../database/database.module";
import { TotpActivationService } from "./totp-activation.service";

@Module({ imports: [DatabaseModule], providers: [TotpActivationService] })
class TotpActivationCliModule {}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--email" || !process.stdout.isTTY) {
    console.error("Uso em terminal interativo: tsx src/auth/issue-first-admin-totp.ts --email <conta-bootstrap>. Não redirecione a saída.");
    process.exitCode = 2;
    return;
  }
  let app: INestApplicationContext | undefined;
  try {
    app = await NestFactory.createApplicationContext(TotpActivationCliModule, { logger: false });
    const result = await app.get(TotpActivationService).issue(args[1]);
    console.error("SIGILOSO: autorização de uso único, válida por 30 minutos. Não grave logs, screenshots ou histórico; entregue somente ao titular autenticado por senha.");
    console.log(result.activationToken);
    console.log(`Expira em: ${result.expiresAt}`);
  } catch {
    console.error("Emissão TOTP recusada ou indisponível. Nenhum segredo será exibido; confira a elegibilidade e a configuração local.");
    process.exitCode = 1;
  } finally { if (app) await app.close().catch(() => undefined); }
}

if (require.main === module) void run();
