// src/indexedDB.js

// Cấu hình IndexedDB
const DB_NAME = 'FileUploadDB';
const DB_VERSION = 1;
const FILE_STORE_NAME = 'files'; // Object Store để lưu file Blob

// Helper function để mở database IndexedDB
export const openDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            // Kiểm tra xem object store đã tồn tại chưa trước khi tạo
            if (!db.objectStoreNames.contains(FILE_STORE_NAME)) {
                // Tạo object store để lưu file, sử dụng 'fileId' làm key
                db.createObjectStore(FILE_STORE_NAME, { keyPath: 'fileId' });
            }
        };

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };

        request.onerror = (event) => {
            // SỬA LỖI: Ném Error thay vì chuỗi
            reject(new Error(`IndexedDB error: ${event.target.errorCode}`));
        };
    });
};

// Helper function để lưu file Blob vào IndexedDB
export const saveFileToDB = async (fileId, fileBlob) => {
    const db = await openDB(); // Đảm bảo DB đã mở
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(FILE_STORE_NAME, 'readwrite'); // Transaction ghi/đọc
        const store = transaction.objectStore(FILE_STORE_NAME); // Lấy object store

        const fileData = { fileId: fileId, fileBlob: fileBlob }; // Dữ liệu cần lưu
        const request = store.put(fileData); // 'put' sẽ thêm hoặc cập nhật nếu đã tồn tại

        request.onsuccess = () => {
            resolve(); // Hoàn thành khi lưu thành công
        };

        request.onerror = (event) => {
            // SỬA LỖI: Ném Error thay vì chuỗi
            reject(new Error(`Error saving file to DB: ${event.target.errorCode}`));
        };
    });
};

// Helper function để lấy file Blob từ IndexedDB bằng fileId
export const getFileFromDB = async (fileId) => {
    const db = await openDB(); // Đảm bảo DB đã mở
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(FILE_STORE_NAME, 'readonly'); // Transaction chỉ đọc
        const store = transaction.objectStore(FILE_STORE_NAME); // Lấy object store

        const request = store.get(fileId); // Lấy dữ liệu theo key

        request.onsuccess = (event) => {
            // Trả về fileBlob nếu tìm thấy (nằm trong event.target.result.fileBlob), ngược lại là undefined
            resolve(event.target.result ? event.target.result.fileBlob : undefined);
        };

        request.onerror = (event) => {
            // SỬA LỖI: Ném Error thay vì chuỗi
            reject(new Error(`Error getting file from DB: ${event.target.errorCode}`));
        };
    });
};

// Helper function để xóa file Blob khỏi IndexedDB bằng fileId
export const deleteFileFromDB = async (fileId) => {
    const db = await openDB(); // Đảm bảo DB đã mở
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(FILE_STORE_NAME, 'readwrite'); // Transaction ghi/đọc
        const store = transaction.objectStore(FILE_STORE_NAME); // Lấy object store

        const request = store.delete(fileId); // Xóa dữ liệu theo key

        request.onsuccess = () => {
            resolve(); // Hoàn thành khi xóa thành công
        };

        request.onerror = (event) => {
            // SỬA LỖI: Ném Error thay vì chuỗi
            reject(new Error(`Error deleting file from DB: ${event.target.errorCode}`));
        };
    });
};

// Export các hằng số cấu hình nếu cần sử dụng ở nơi khác (ví dụ: để biết tên DB)
// export { DB_NAME, DB_VERSION, FILE_STORE_NAME };