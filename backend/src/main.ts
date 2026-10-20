import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { environment } from "./config/environment";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();
  await app.listen(environment.PORT, "127.0.0.1");
}

void bootstrap();
