export interface LocalWorkspaceFile {
  id: string;
  workspaceId: string;
  name: string;
  contentType: string;
  size: number;
  currentVersion: number;
  createdAt: number;
  updatedAt: number;
  bytes: ArrayBuffer;
}

const DATABASE_NAME = "gama-work-local-files";
const STORE_NAME = "files";
const DATABASE_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("workspaceId", "workspaceId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir o armazenamento local."));
  });
}

async function inStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = run(transaction.objectStore(STORE_NAME));
      let result: T;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error ?? new Error("Não foi possível acessar o armazenamento local."));
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error ?? new Error("O navegador não conseguiu salvar os dados locais."));
      transaction.onerror = () => reject(transaction.error ?? new Error("O navegador não conseguiu salvar os dados locais."));
    });
  } finally {
    database.close();
  }
}

export async function listLocalFiles(workspaceId: string): Promise<LocalWorkspaceFile[]> {
  const database = await openDatabase();
  try {
    return await new Promise<LocalWorkspaceFile[]>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).index("workspaceId").getAll(workspaceId) as IDBRequest<LocalWorkspaceFile[]>;
      request.onsuccess = () => resolve(request.result.sort((a, b) => b.updatedAt - a.updatedAt));
      request.onerror = () => reject(request.error ?? new Error("Não foi possível carregar os arquivos locais."));
    });
  } finally {
    database.close();
  }
}

export function getLocalFile(id: string): Promise<LocalWorkspaceFile | undefined> {
  return inStore("readonly", (store) => store.get(id) as IDBRequest<LocalWorkspaceFile | undefined>);
}

export function saveLocalFile(file: LocalWorkspaceFile): Promise<IDBValidKey> {
  return inStore("readwrite", (store) => store.put(file));
}

export function deleteLocalFile(id: string): Promise<undefined> {
  return inStore("readwrite", (store) => store.delete(id) as IDBRequest<undefined>);
}

export function bytesBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}
