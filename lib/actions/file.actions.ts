"use server";

import { createAdminClient } from "@/lib/appwrite";
import { InputFile } from "node-appwrite/file";
import { appwriteConfig } from "@/lib/appwrite/congif";
import { ID, Models, Query } from "node-appwrite";
import { constructFileUrl, getFileType, parseStringify } from "@/lib/utils";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/actions/user.actions";

const handleError = (error: unknown, message: string) => {
  console.log(error, message);
  throw error;
};

// The admin client bypasses Appwrite permissions, so every change to a file
// has to check here that it belongs to the signed-in user.
const requireOwnedFile = async (fileId: string) => {
  const currentUser = await getCurrentUser();
  if (!currentUser) throw new Error("User is not authenticated.");

  const { tables } = await createAdminClient();
  const file = await tables.getRow({
    databaseId: appwriteConfig.databaseId,
    tableId: appwriteConfig.filesCollectionId,
    rowId: fileId,
  });

  if (file.accountId !== currentUser.accountId) {
    throw new Error("Only the owner can change this file.");
  }

  return file;
};

export const uploadFile = async ({ file, path }: UploadFileProps) => {
  const { storage, tables } = await createAdminClient();

  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) throw new Error("User is not authenticated.");

    const inputFile = InputFile.fromBuffer(file, file.name);

    const bucketFile = await storage.createFile({
      bucketId: appwriteConfig.bucketId,
      fileId: ID.unique(),
      file: inputFile,
    });

    const fileDocument = {
      type: getFileType(bucketFile.name).type,
      name: bucketFile.name,
      url: constructFileUrl(bucketFile.$id),
      extension: getFileType(bucketFile.name).extension,
      size: bucketFile.sizeOriginal,
      owner: currentUser.$id,
      accountId: currentUser.accountId,
      users: [],
      bucketFileId: bucketFile.$id,
    };

    const newFile = await tables
      .createRow({
        databaseId: appwriteConfig.databaseId,
        tableId: appwriteConfig.filesCollectionId,
        rowId: ID.unique(),
        data: fileDocument,
      })
      .catch(async (error: unknown) => {
        await storage.deleteFile({
          bucketId: appwriteConfig.bucketId,
          fileId: bucketFile.$id,
        });
        handleError(error, "Failed to create file document");
      });

    revalidatePath(path);
    return parseStringify(newFile);
  } catch (error) {
    handleError(error, "Failed to upload file");
  }
};

const createQueries = (
  currentUser: Models.DefaultRow,
  types: string[],
  searchText: string,
  sort: string,
  limit?: number,
) => {
  const queries = [
    // Related rows are only returned when they are selected explicitly
    Query.select(["*", "owner.*"]),
    Query.or([
      Query.equal("owner", [currentUser.$id]),
      Query.contains("users", [currentUser.email]),
    ]),
  ];

  if (types.length > 0) queries.push(Query.equal("type", types));
  if (searchText) queries.push(Query.contains("name", searchText));
  if (limit) queries.push(Query.limit(limit));

  if (sort) {
    const [sortBy, orderBy] = sort.split("-");

    queries.push(
      orderBy === "asc" ? Query.orderAsc(sortBy) : Query.orderDesc(sortBy),
    );
  }

  return queries;
};

export const getFiles = async ({
  types = [],
  searchText = "",
  sort = "$createdAt-desc",
  limit,
}: GetFilesProps) => {
  const { tables } = await createAdminClient();

  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) throw new Error("User not found");

    const queries = createQueries(currentUser, types, searchText, sort, limit);

    const { total, rows } = await tables.listRows({
      databaseId: appwriteConfig.databaseId,
      tableId: appwriteConfig.filesCollectionId,
      queries,
    });

    return parseStringify({ total, documents: rows });
  } catch (error) {
    handleError(error, "Failed to get files");
  }
};

export const renameFile = async ({
  fileId,
  name,
  extension,
  path,
}: RenameFileProps) => {
  const { tables } = await createAdminClient();

  try {
    await requireOwnedFile(fileId);

    const newName = `${name}.${extension}`;
    const updatedFile = await tables.updateRow({
      databaseId: appwriteConfig.databaseId,
      tableId: appwriteConfig.filesCollectionId,
      rowId: fileId,
      data: {
        name: newName,
      },
    });

    revalidatePath(path);
    return parseStringify(updatedFile);
  } catch (error) {
    handleError(error, "Failed to rename file");
  }
};

export const updateFileUsers = async ({
  fileId,
  emails,
  path,
}: UpdateFileUsersProps) => {
  const { tables } = await createAdminClient();

  try {
    await requireOwnedFile(fileId);

    const updatedFile = await tables.updateRow({
      databaseId: appwriteConfig.databaseId,
      tableId: appwriteConfig.filesCollectionId,
      rowId: fileId,
      data: {
        users: emails,
      },
    });

    revalidatePath(path);
    return parseStringify(updatedFile);
  } catch (error) {
    handleError(error, "Failed to rename file");
  }
};

export const deleteFile = async ({ fileId, path }: DeleteFileProps) => {
  const { tables, storage } = await createAdminClient();

  try {
    const file = await requireOwnedFile(fileId);

    await tables.deleteRow({
      databaseId: appwriteConfig.databaseId,
      tableId: appwriteConfig.filesCollectionId,
      rowId: fileId,
    });

    await storage.deleteFile({
      bucketId: appwriteConfig.bucketId,
      fileId: file.bucketFileId,
    });

    revalidatePath(path);
    return parseStringify({ status: "success" });
  } catch (error) {
    handleError(error, "Failed to rename file");
  }
};

export async function getTotalSpaceUsed() {
  try {
    const { tables } = await createAdminClient();
    const currentUser = await getCurrentUser();
    if (!currentUser) throw new Error("User is not authenticated.");

    // Appwrite returns 25 rows by default, so read every page
    const PAGE_SIZE = 500;
    const files: Models.DefaultRow[] = [];
    let page: Models.DefaultRow[];

    do {
      const queries = [
        Query.equal("owner", [currentUser.$id]),
        Query.limit(PAGE_SIZE),
      ];
      if (files.length > 0) {
        queries.push(Query.cursorAfter(files[files.length - 1].$id));
      }

      ({ rows: page } = await tables.listRows({
        databaseId: appwriteConfig.databaseId,
        tableId: appwriteConfig.filesCollectionId,
        queries,
      }));
      files.push(...page);
    } while (page.length === PAGE_SIZE);

    const totalSpace = {
      image: { size: 0, latestDate: "" },
      document: { size: 0, latestDate: "" },
      video: { size: 0, latestDate: "" },
      audio: { size: 0, latestDate: "" },
      other: { size: 0, latestDate: "" },
      used: 0,
      all: 2 * 1024 * 1024 * 1024 /* 2GB available bucket storage */,
    };

    files.forEach((file) => {
      const fileType = file.type as FileType;
      totalSpace[fileType].size += file.size;
      totalSpace.used += file.size;

      if (
        !totalSpace[fileType].latestDate ||
        new Date(file.$updatedAt) > new Date(totalSpace[fileType].latestDate)
      ) {
        totalSpace[fileType].latestDate = file.$updatedAt;
      }
    });

    return parseStringify(totalSpace);
  } catch (error) {
    handleError(error, "Error calculating total space used:, ");
  }
}
