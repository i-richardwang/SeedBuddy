import { bootstrap } from "../src/server/bootstrap";
import { closeDatabase } from "../src/server/infra/db/client";
import {
  collectionReport,
  collectUnreferencedBlobs,
} from "../src/server/maintenance/collection";

bootstrap();

try {
  console.log(collectionReport(await collectUnreferencedBlobs()));
} finally {
  await closeDatabase();
}
