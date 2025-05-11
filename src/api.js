// src/api.js

// --- CẤU HÌNH API ---
const UPLOAD_CHUNK_API_URL = 'http://localhost:8088/api/upload-service/chunk';
const UPLOAD_COMPLETE_API_URL = 'http://localhost:8088/api/upload-service/complete';
const CANCEL_JOB_API_URL = 'http://localhost:8088/api/upload-service/cancel';

// --- HELPER FUNCTIONS cho Server API ---

// Hàm gửi một chunk video lên server
export const uploadChunk = async (chunk, fileId, chunkIndex) => {
    console.log(`Uploading chunk ${chunkIndex} for file ${fileId}`);
    const formData = new FormData();
    formData.append('file', chunk);
    formData.append('fileId', fileId);
    formData.append('chunkIndex', chunkIndex);

    const response = await fetch(UPLOAD_CHUNK_API_URL, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Lỗi tải lên chunk ${chunkIndex + 1}: ${response.status} - ${errorText}`);
    }

    // console.log(`Chunk ${chunkIndex} success response:`, await response.text()); // Có thể log text nếu server trả về text
    return response;
};

// Hàm gửi yêu cầu hoàn thành upload sau khi gửi hết các chunk
export const completeUpload = async (fileId, totalChunks, originalFileName) => {
    console.log(`Completing upload for file ${fileId} with ${totalChunks} chunks.`);
    const completeFormData = new FormData(); // Giả định API complete nhận FormData
    completeFormData.append('fileId', fileId);
    completeFormData.append('totalChunks', totalChunks);
    completeFormData.append('originalFileName', originalFileName);

    const response = await fetch(UPLOAD_COMPLETE_API_URL, {
        method: 'POST',
        body: completeFormData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Lỗi hoàn tất upload: ${response.status} - ${errorText}`);
    }

    // *** SỬA LỖI: Đọc phản hồi dạng văn bản thuần túy thay vì JSON ***
    const jobIdString = await response.text(); // <-- Dùng .text() thay vì .json()
    console.log('Yêu cầu hoàn tất upload thành công, nhận Job ID (text):', jobIdString);

    // Backend chỉ trả về jobId dưới dạng text, nên không cần parse JSON và lấy thuộc tính jobId
    // Chỉ cần kiểm tra xem chuỗi jobId có rỗng không ở nơi gọi hàm này (handleUpload)
    // Hàm này trả về chuỗi jobId
    return jobIdString;
};


// Hàm gửi yêu cầu hủy job lên server
export const cancelJobOnServer = async (jobIdentifier, isJobId = false) => {
    // jobIdentifier có thể là fileId (trước complete) hoặc jobId (sau complete)
    if (!jobIdentifier) {
        console.warn("No job identifier provided for server cancellation.");
        return;
    }
    console.log(`Attempting to cancel job ${jobIdentifier} on server.`);
    try {
        const response = await fetch(CANCEL_JOB_API_URL, {
            method: 'POST', // Hoặc 'DELETE'
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jobIdentifier: jobIdentifier,
                identifierType: isJobId ? 'jobId' : 'fileId'
            }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Server failed to cancel job ${jobIdentifier}: ${response.status} - ${errorText}`);
        } else {
            console.log(`Job ${jobIdentifier} cancellation request sent to server successfully.`);
        }
    } catch (error) {
        console.error(`Error calling server cancel API for job ${jobIdentifier}:`, error);
    }
};