// Creates the database, tables and bucket this app needs in an Appwrite
// project. Safe to run more than once: anything that already exists is kept.
//
//   npm run setup:appwrite

import {
  Client,
  Permission,
  RelationMutate,
  RelationshipType,
  Role,
  Storage,
  TablesDB,
  TablesDBIndexType,
} from "node-appwrite";

const env = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name} in .env.local`);
    process.exit(1);
  }
  return value;
};

const endpoint = env("NEXT_PUBLIC_APPWRITE_ENDPOINT");
const projectId = env("NEXT_PUBLIC_APPWRITE_PROJECT");
const databaseId = env("NEXT_PUBLIC_APPWRITE_DATABASE");
const usersId = env("NEXT_PUBLIC_APPWRITE_USERS_COLLECTION");
const filesId = env("NEXT_PUBLIC_APPWRITE_FILES_COLLECTION");
const bucketId = env("NEXT_PUBLIC_APPWRITE_BUCKET");
const apiKey = env("NEXT_APPWRITE_KEY");

const client = new Client()
  .setEndpoint(endpoint)
  .setProject(projectId)
  .setKey(apiKey);
const tables = new TablesDB(client);
const storage = new Storage(client);

const MAX_FILE_SIZE = 50_000_000; // keep in sync with constants/index.ts

// `get` is for resources with a plan limit: Appwrite reports the limit before
// it reports that the resource already exists.
const ensure = async (label, create, get) => {
  try {
    if (get) {
      const found = await get().catch((error) => {
        if (error.code !== 404) throw error;
      });
      if (found) return console.log(`exists   ${label}`);
    }

    await create();
    console.log(`created  ${label}`);
  } catch (error) {
    if (error.code !== 409) {
      throw new Error(`${label}: ${error.message}`, { cause: error });
    }
    console.log(`exists   ${label}`);
  }
};

// Columns are built in the background; indexes and relationships need them.
const waitForColumns = async (tableId) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const { columns } = await tables.listColumns({ databaseId, tableId });
    const failed = columns.find(
      (c) => c.status === "failed" || c.status === "stuck",
    );
    if (failed) throw new Error(`${tableId}.${failed.key}: ${failed.error}`);
    if (columns.every((c) => c.status === "available")) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for columns of ${tableId}`);
};

const table = (tableId, name) =>
  ensure(`table ${tableId}`, () =>
    tables.createTable({ databaseId, tableId, name, permissions: [] }),
  );

const column = (tableId, type, options) =>
  ensure(`${tableId}.${options.key}`, () =>
    tables[`create${type}Column`]({ databaseId, tableId, ...options }),
  );

const index = (tableId, key, type, columns) =>
  ensure(`${tableId} index ${key}`, () =>
    tables.createIndex({ databaseId, tableId, key, type, columns }),
  );

const main = async () => {
  await ensure(
    `database ${databaseId}`,
    () => tables.create({ databaseId, name: "Drive" }),
    () => tables.get({ databaseId }),
  );

  // No table permissions: only the server (API key) can touch the data.
  await table(usersId, "Users");
  await column(usersId, "Varchar", {
    key: "fullName",
    size: 255,
    required: true,
  });
  await column(usersId, "Email", { key: "email", required: true });
  await column(usersId, "Url", { key: "avatar", required: true });
  await column(usersId, "Varchar", {
    key: "accountId",
    size: 64,
    required: true,
  });
  await waitForColumns(usersId);
  await index(usersId, "email_unique", TablesDBIndexType.Unique, ["email"]);
  await index(usersId, "accountId_unique", TablesDBIndexType.Unique, [
    "accountId",
  ]);

  await table(filesId, "Files");
  await column(filesId, "Varchar", { key: "name", size: 255, required: true });
  await column(filesId, "Enum", {
    key: "type",
    elements: ["document", "image", "video", "audio", "other"],
    required: true,
  });
  await column(filesId, "Url", { key: "url", required: true });
  await column(filesId, "Varchar", {
    key: "extension",
    size: 255,
    required: false,
  });
  await column(filesId, "Integer", { key: "size", required: true, min: 0 });
  await column(filesId, "Varchar", {
    key: "accountId",
    size: 64,
    required: true,
  });
  await column(filesId, "Varchar", {
    key: "bucketFileId",
    size: 64,
    required: true,
  });
  await column(filesId, "Varchar", {
    key: "users",
    size: 320,
    required: false,
    array: true,
  });
  await column(filesId, "Relationship", {
    key: "owner",
    relatedTableId: usersId,
    type: RelationshipType.ManyToOne,
    twoWay: false,
    onDelete: RelationMutate.Restrict,
  });
  await waitForColumns(filesId);
  await index(filesId, "type_key", TablesDBIndexType.Key, ["type"]);

  // Files open through plain /view links, so anyone with a link can read them.
  await ensure(
    `bucket ${bucketId}`,
    () =>
      storage.createBucket({
        bucketId,
        name: "Uploads",
        permissions: [Permission.read(Role.any())],
        fileSecurity: false,
        maximumFileSize: MAX_FILE_SIZE,
      }),
    () => storage.getBucket({ bucketId }),
  );

  console.log("\nAppwrite is ready. Run: npm run dev");
};

main().catch((error) => {
  console.error(`\nSetup failed: ${error.message}`);
  process.exit(1);
});
