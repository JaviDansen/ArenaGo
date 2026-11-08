import { Module, type INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DatabaseModule } from "../database/database.module";
import { FirstAdminBootstrapService } from "./first-admin-bootstrap.service";

@Module({ imports: [DatabaseModule], providers: [FirstAdminBootstrapService] })
class FirstAdminBootstrapCliModule {}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--email") {
    console.error("Uso: tsx src/auth/bootstrap-first-admin.ts --email <conta-existente>");
    process.exitCode = 2;
    return;
  }

  let app: INestApplicationContext | undefined;
  try {
    app = await NestFactory.createApplicationContext(FirstAdminBootstrapCliModule, { logger: false });
    const result = await app.get(FirstAdminBootstrapService).bootstrap(args[1]);
    const messages = {
      created: "Primeiro Admin concedido e auditado. Recursos Admin permanecem bloqueados até a configuração legítima do TOTP.",
      already_bootstrapped: "Bootstrap indisponível: já existe ou existiu um papel Admin global.",
      account_not_found: "Conta não elegível para bootstrap.",
      account_inactive: "Conta não elegível para bootstrap.",
      email_unverified: "Conta não elegível para bootstrap.",
      invalid_email: "Informe um e-mail válido de uma conta existente.",
    } satisfies Record<typeof result.kind, string>;
    if (result.kind === "created") console.log(messages[result.kind]);
    else {
      console.error(messages[result.kind]);
      process.exitCode = 1;
    }
  } catch {
    console.error("Bootstrap falhou; a transação foi revertida quando aplicável. Consulte o estado do banco antes de repetir.");
    process.exitCode = 1;
  } finally {
    if (app) await app.close().catch(() => undefined);
  }
}

if (require.main === module) void run();
