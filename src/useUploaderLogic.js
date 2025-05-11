// src/useUploaderLogic.js

import { useState, useEffect, useRef } from 'react';
import { saveFileToDB, getFileFromDB, deleteFileFromDB } from './indexedDB';
import { uploadChunk, completeUpload, cancelJobOnServer } from './api';

// --- CẤU HƯƠNG ---
const UPLOAD_CHUNK_API_URL = 'http://localhost:8088/api/upload-service/chunk';
const UPLOAD_COMPLETE_API_URL = 'http://localhost:8088/api/upload-service/complete';
const WEBSOCKET_URL = 'ws://localhost:8088/ws';
const CHUNK_SIZE = 0.5 * 1024 * 1024;
const LOCAL_STORAGE_UPLOAD_STATE_KEY = 'videoUploadState';


// --- Custom Hook ---
const useUploaderLogic = () => {

    // --- State cho Upload HTTP Chunk ---
    const [selectedFile, setSelectedFile] = useState(null); // Đối tượng File được user chọn khi KHỚP resume hoặc BẮT ĐẦU MỚI
    const [fileSelectedButNotMatching, setFileSelectedButNotMatching] = useState(null); // Đối tượng File user chọn khi KHÔNG KHỚP resume
    const [uploadProgress, setUploadProgress] = useState(0); // Tiến trình upload chunk HTTP (0-100)
    const [isUploading, setIsUploading] = useState(false); // Đánh dấu đang upload chunk
    const [isCompletingUpload, setIsCompletingUpload] = useState(false); // Đánh dấu đang gửi yêu cầu hoàn thành
    const [uploadedChunks, setUploadedChunks] = useState(0); // Số chunk đã upload thành công
    const [totalChunks, setTotalChunks] = useState(0); // Tổng số chunk
    // currentUploadFileId: fileId của job ĐANG ACTIVE hoặc ĐANG CHỜ RESUME (uploading hoặc processing)
    const [currentUploadFileId, setCurrentUploadFileId] = useState(null);

    // --- State cho WebSocket và Tiến trình Video Processing ---
    const [jobId, setJobId] = useState(null); // Lưu job ID nhận được sau khi upload hoàn tất
    const [videoProcessingProgress, setVideoProcessingProgress] = useState(0); // Tiến trình video processing nhận qua WebSocket (0-100)
    const [videoProcessingStatus, setVideoProcessingStatus] = useState(''); // Trạng thái video processing nhận qua WebSocket

    // --- State cho Resume ---
    const [resumeState, setResumeState] = useState(null); // Trạng thái đọc được từ localStorage khi mount. Nguồn sự thật cho job dang dở.

    // --- State UI Luồng Rẽ nhánh ---
    const [uiState, setUiState] = useState('initial');

    // --- State cho Modals xác nhận ---
    const [showCancelConfirmModal, setShowCancelConfirmModal] = useState(false); // <-- State modal hủy
    const [showUploadNewConfirmModal, setShowUploadNewConfirmModal] = useState(false); // <-- State modal tải mới


    // --- State chung ---
    const [statusMessage, setStatusMessage] = useState('Chọn video để tải lên.');
    const websocketRef = useRef(null);
    const isCancelledRef = useRef(false);


    // --- HELPER HANDLERS (Nội bộ Hook) ---

    // Hàm dọn dẹp toàn bộ trạng thái resume/job đang lưu cục bộ (localStorage, IndexedDB, WebSocket)
    // Chỉ xóa file data trong IndexedDB nếu có fileId được truyền vào.
    // KHÔNG reset UI states hoặc gọi server cancel ở đây. Chỉ xóa dữ liệu cục bộ.
    const clearLocalJobState = async (fileIdToClear) => { // fileIdToClear sẽ được lấy từ state/resumeState khi gọi hàm này
        console.log(`Clearing local job state for fileId: ${fileIdToClear}`);
        localStorage.removeItem(LOCAL_STORAGE_UPLOAD_STATE_KEY);
        if (fileIdToClear) {
            try {
                await deleteFileFromDB(fileIdToClear);
                console.log(`File data ${fileIdToClear} cleared from IndexedDB.`);
            } catch (e) {
                console.error(`Error clearing file data ${fileIdToClear} from IndexedDB:`, e);
            }
        }
        // Đóng WebSocket nếu đang mở (đặt flag cancel trước khi đóng để onclose biết)
        // WebSocketRef được truyền vào Hook
        if (websocketRef.current) {
            console.log("Closing WebSocket connection during local state clear.");
            isCancelledRef.current = true; // Đặt flag trước khi đóng
            try { websocketRef.current.close(); } catch(e) { console.warn("Error closing WS:", e); }
            websocketRef.current = null; // Xóa ref
        }
        // Reset state UI LIÊN QUAN ĐẾN JOB/RESUME
        setCurrentUploadFileId(null);
        setJobId(null); // Set jobId = null sẽ kích hoạt useEffect ở component cha đóng/reset socket
        setResumeState(null);
        // Không reset selectedFile, fileSelectedButNotMatching ở đây, vì chúng có thể cần giữ lại
        // cho luồng chọn file không khớp. Reset UI sẽ làm ở hàm resetUploader.
    };

    // Hàm reset toàn bộ UI và state về trạng thái ban đầu (sau khi cancel, hoặc job hoàn thành/thất bại)
    const resetUploader = () => {
        console.log("Resetting uploader UI and states.");
        // clearLocalJobState đã xóa local storage, indexeddb, đóng ws, set currentUploadFileId, jobId, resumeState = null
        // clearLocalJobState(currentUploadFileId); // Called before resetUploader or handled by clearLocalJobState itself

        setSelectedFile(null); // Reset file được chọn
        setFileSelectedButNotMatching(null); // Reset file không khớp
        setUploadProgress(0);
        setIsUploading(false);
        setIsCompletingUpload(false);
        setUploadedChunks(0);
        setTotalChunks(0);
        setVideoProcessingProgress(0);
        setVideoProcessingStatus('');
        setUiState('initial'); // Trạng thái UI ban đầu
        setStatusMessage('Chọn video để tải lên.'); // Thông báo ban đầu
        isCancelledRef.current = false; // Reset flag cancel
    };

    // *** Hàm thực hiện logic hủy bỏ thực sự (gọi từ modal Hủy) ***
    const performCancellation = async () => {
        console.log("Performing actual cancellation logic.");
        setStatusMessage("Đang hủy bỏ quá trình...");

        // Lấy jobIdentifier của job đang active/resume/pending để báo hủy server và xóa local DB
        let jobIdentifierToCancel = resumeState?.jobId || resumeState?.fileId;
        let isJobIdToCancel = !!resumeState?.jobId; // Xác định xem định danh là jobId hay fileId

        if (jobIdentifierToCancel) {
            console.log(`Cancelling job ${jobIdentifierToCancel} on server.`);
            // Gửi yêu cầu hủy job lên server
            await cancelJobOnServer(jobIdentifierToCancel, isJobIdToCancel);
        } else {
            console.log("No active job to cancel on server.");
        }

        // Dọn dẹp toàn bộ trạng thái và dữ liệu job đang active/resume cục bộ
        // clearLocalJobState sẽ xử lý xóa localStorage, IndexedDB, đóng WebSocket, và reset state job-related
        // Chúng ta truyền fileId tương ứng để đảm bảo xóa đúng file khỏi IndexedDB
        // FileId để xóa trong DB luôn là resumeState?.fileId. currentUploadFileId cũng sẽ null sau clearLocalJobState
        await clearLocalJobState(resumeState?.fileId); // Sử dụng resumeState?.fileId để đảm bảo xóa đúng file của job đó


        // Reset toàn bộ UI và state về trạng thái ban đầu sau khi dọn dẹp xong
        resetUploader();
        setStatusMessage("Quá trình đã bị hủy bởi người dùng."); // Thông báo cuối cùng sau khi hủy và reset

    };

    // *** Hàm thực hiện logic tải file mới và hủy job cũ (gọi từ modal Tải mới) ***
    const performUploadNewAndCancelOldLogic = async () => {
        console.log("Performing upload new and cancel old logic.");
        // selectedFile phải giữ file mới ở trạng thái resume_mismatch_choice
        if (!selectedFile) {
            console.error("performUploadNewAndCancelOldLogic called but no selectedFile!");
            setStatusMessage("Lỗi: Không tìm thấy file mới để tải lên.");
            resetUploader(); // Về trạng thái ban đầu
            return;
        }
        // File mới được chọn để upload chính là selectedFile.
        // fileSelectedButNotMatching chỉ là bản copy tạm, giờ không cần nữa.

        // *** Bước 1: Hủy bỏ job cũ (nếu có) ***
        // Lấy jobIdentifier của job cũ từ resumeState trước khi xóa nó
        let oldJobIdentifierToCancel = resumeState?.jobId || resumeState?.fileId;
        let isOldJobId = !!resumeState?.jobId;

        if (oldJobIdentifierToCancel) {
            console.log(`Cancelling old job ${oldJobIdentifierToCancel} before starting new one.`);
            // Gửi yêu cầu hủy job cũ lên server
            await cancelJobOnServer(oldJobIdentifierToCancel, isOldJobId);
            // Dọn dẹp local state của job cũ (localStorage, IndexedDB)
            // clearLocalJobState cần fileId của job cũ để xóa file trong DB
            await clearLocalJobState(resumeState.fileId); // fileId của job cũ nằm trong resumeState.fileId
        } else {
            console.log("No old job to cancel.");
            // Nếu không có job cũ (resumeState null), chỉ cần đảm bảo UI sạch (resetUploader sẽ làm việc này)
            // và proceed start new upload.
        }

        // *** Bước 2: Bắt đầu quá trình upload file mới ***
        // Sau khi clearLocalJobState, các state job cũ đã null (resumeState, currentUploadFileId, jobId).
        // selectedFile đang giữ file mới cần upload.
        // Chúng ta sẽ gọi hàm handleUpload để bắt đầu quá trình upload mới cho selectedFile.

        // Cập nhật status message ban đầu cho việc upload mới
        setStatusMessage(`Đang chuẩn bị tải lên file "${selectedFile.name}"...`);
        // uiState sẽ được set sang 'uploading' trong handleUpload
        // setUiState('ready_to_upload_new'); // Không cần set ở đây, handleUpload sẽ set 'uploading'

        // Reset các state upload chunk (không ảnh hưởng selectedFile)
        setUploadProgress(0);
        setUploadedChunks(0);
        setTotalChunks(0);
        setIsUploading(false);
        setIsCompletingUpload(false);


        // Gọi handleUpload để bắt đầu quá trình upload mới
        // handleUpload sẽ nhận selectedFile, tạo fileId mới, lưu DB, lưu localStorage, và bắt đầu vòng lặp gửi chunk
        handleUpload(); // Không await ở đây để hàm này chạy bất đồng bộ

        // Reset fileSelectedButNotMatching sau khi đã xử lý nó
        setFileSelectedButNotMatching(null);

    };


    // --- EFFECTS (Quản lý vòng đời của Hook và WebSocket) ---

    // EFFECT chạy khi component mount để kiểm tra trạng thái resume trong localStorage
    useEffect(() => {
        const savedState = localStorage.getItem(LOCAL_STORAGE_UPLOAD_STATE_KEY);
        if (savedState) {
            try {
                const state = JSON.parse(savedState);
                // Kiểm tra xem trạng thái có hợp lệ và còn đang dang dở không
                if (state && (state.status === 'uploading' || state.status === 'processing')) {
                    setResumeState(state); // Lưu trạng thái vào state resume
                    setCurrentUploadFileId(state.fileId); // Set fileId hiện tại

                    if (state.status === 'uploading') {
                        // Đang trong giai đoạn upload chunk dang dở
                        const calculatedTotalChunks = Math.ceil(state.fileSize / CHUNK_SIZE);
                        // Chỉ set totalChunks nếu nó hợp lệ
                        if (!isNaN(calculatedTotalChunks) && calculatedTotalChunks > 0) {
                            setTotalChunks(calculatedTotalChunks);
                            setUploadedChunks(state.lastChunkIndex + 1); // Chuẩn bị bắt đầu từ chunk kế tiếp
                            setUploadProgress(Math.round((state.lastChunkIndex + 1) / calculatedTotalChunks * 100));

                            setStatusMessage(
                                `Tìm thấy quá trình tải lên dang dở cho file "${state.fileName}" (${Math.round((state.lastChunkIndex + 1) / calculatedTotalChunks * 100)}% đã tải lên). Vui lòng chọn lại file "${state.fileName}" để tiếp tục.`
                            );
                            setUiState('pending_resume_select_file'); // Cập nhật trạng thái UI

                        } else {
                            console.error("Invalid totalChunks in resume state. Clearing state.");
                            // Clear local state và reset UI
                            clearLocalJobState(state.fileId); // Xóa trạng thái lỗi
                            resetUploader();
                            setStatusMessage('Tìm thấy trạng thái lỗi. Vui lòng chọn video để tải lên.');
                        }

                    } else if (state.status === 'processing') {
                        // Đang trong giai đoạn processing dang dở
                        if (state.jobId) {
                            setJobId(state.jobId); // Set jobId để kích hoạt WebSocket effect
                            setVideoProcessingProgress(state.processingProgress || 0); // Khôi phục tiến trình nếu có
                            setVideoProcessingStatus(state.processingStatus || ''); // Khôi phục trạng thái
                            setStatusMessage(
                                `Tìm thấy quá trình xử lý dang dở cho file "${state.fileName}" (Job ID: ${state.jobId}). Đang kết nối lại để theo dõi tiến trình.`
                            );
                            setUiState('processing'); // Cập nhật trạng thái UI (sẽ được cập nhật tiếp bởi WebSocket effect)

                        } else {
                            console.error("Invalid jobId in processing resume state. Clearing state.");
                            // Clear local state và reset UI
                            clearLocalJobState(state.fileId);
                            resetUploader();
                            setStatusMessage('Tìm thấy trạng thái lỗi. Vui lòng chọn video để tải lên.');
                        }

                    }

                } else {
                    // Trạng thái không hợp lệ hoặc đã hoàn thành -> xóa local state và reset UI
                    console.log("Found completed or invalid state, clearing.");
                    // Cần xóa cả file data trong IndexedDB nếu job hoàn thành/lỗi mà chưa kịp xóa
                    const fileIdFromState = state?.fileId; // Lấy fileId trước khi xóa state
                    localStorage.removeItem(LOCAL_STORAGE_UPLOAD_STATE_KEY); // Xóa state ngay lập tức
                    if (fileIdFromState) {
                        deleteFileFromDB(fileIdFromState).catch(console.error); // Xóa file async
                    }
                    resetUploader(); // Reset UI
                }

            } catch (e) {
                console.error("Lỗi khi đọc trạng thái upload từ localStorage:", e);
                // Xóa trạng thái localStorage nếu không parse được
                localStorage.removeItem(LOCAL_STORAGE_UPLOAD_STATE_KEY);
                // Không biết fileId để xóa IndexedDB, có thể cần quét toàn bộ hoặc bỏ qua
                resetUploader(); // Reset UI
                setStatusMessage('Lỗi khi đọc trạng thái. Vui lòng chọn video để tải lên.');
            }
        } else {
            // Không có trạng thái lưu trữ -> UI ở trạng thái initial
            setUiState('initial');
        }
    }, []); // Chỉ chạy một lần khi component mount

    // EFFECT chạy khi resumeState là UPLOADING để kiểm tra file Blob trong IndexedDB
    useEffect(() => {
        if (resumeState && resumeState.status === 'uploading' && resumeState.fileId) {
            const checkFileBlob = async () => {
                try {
                    const fileBlob = await getFileFromDB(resumeState.fileId);
                    if (!fileBlob) {
                        console.warn("Không tìm thấy file Blob trong IndexedDB cho trạng thái resume. Clearing state.");
                        // Không tìm thấy file trong DB dù trạng thái localStorage nói có -> xóa trạng thái và reset UI
                        clearLocalJobState(resumeState.fileId);
                        resetUploader();
                        setStatusMessage('Không thể khôi phục file. Vui lòng chọn lại video để tải lên mới.');
                    } else {
                        console.log("File Blob found in IndexedDB for resume.");
                        // File Blob tồn tại, user có thể chọn lại file để bắt đầu resume
                        // UI đã ở 'pending_resume_select_file' nhờ effect mount
                    }
                } catch (e) {
                    console.error("Lỗi khi kiểm tra file Blob từ IndexedDB:", e);
                    // Xóa trạng thái lỗi và reset UI
                    clearLocalJobState(resumeState.fileId);
                    resetUploader();
                    setStatusMessage('Lỗi khi kiểm tra file khôi phục. Vui lòng chọn lại video để tải lên mới.');
                }
            };
            checkFileBlob();
        }
    }, [resumeState]); // Chạy khi resumeState được set (chỉ 1 lần lúc mount nếu có resume)


    // EFFECT để quản lý kết nối WebSocket và cập nhật UI state processing
    // Chạy khi jobId thay đổi hoặc uiState chuyển sang 'processing'
    useEffect(() => {
        // Chỉ mở kết nối khi có jobId và chưa có kết nối WebSocket VÀ UI ở trạng thái processing hoặc sẵn sàng processing (ví dụ: sau khi hoàn tất upload)
        const shouldAttemptConnect = jobId && !websocketRef.current && (uiState === 'processing' || uiState === 'completing'); // Attempt reconnect if completing failed, or just finished completing


        if (shouldAttemptConnect) {
            console.log(`Attempting WebSocket connect for Job ID: ${jobId}`);
            // Reset flag cancel chỉ khi chủ động mở socket
            isCancelledRef.current = false;
            const ws = new WebSocket(WEBSOCKET_URL);
            websocketRef.current = ws;

            ws.onopen = () => {
                console.log("Kết nối WebSocket đã mở thành công.");
                const subscribeMessage = JSON.stringify({
                    action: "subscribe_to_job", // Action báo server biết đây là tin đăng ký
                    jobId: jobId
                });
                ws.send(subscribeMessage);
                setStatusMessage(prevStatus => {
                    if (prevStatus.includes('Tải lên file hoàn tất!')) return prevStatus + ` Kết nối WebSocket mở để theo dõi processing.`;
                    if (prevStatus.includes('Đang kết nối lại để theo dõi')) return prevStatus;
                    return `Kết nối WebSocket mở. Đang chờ tiến trình video processing for Job ID: ${jobId}`; // SỬA LỖI: for -> for
                });
                setUiState('processing'); // Cập nhật trạng thái UI là đang xử lý

            };

            ws.onmessage = (event) => {
                console.log("Received data from Server via WebSocket:", event.data); // SỬA LỖI: from -> from

                try {
                    const message = JSON.parse(event.data);

                    // Kiểm tra xem tin nhắn có phải là cập nhật tiến trình cho job ID hiện tại không
                    // (Kiểm tra cả currentUploadFileId để chắc chắn đang theo dõi đúng job)
                    if (message.jobId === jobId && message.type === 'progress' && currentUploadFileId === (resumeState?.fileId || currentUploadFileId)) { // Add extra check
                        setVideoProcessingProgress(message.progress);
                        setVideoProcessingStatus(message.status || '');
                        // Không set statusMessage liên tục trong onmessage nếu không cần thiết, để giữ message ban đầu
                        // Hoặc chỉ set khi trạng thái processing thay đổi đáng kể (ví dụ: từ 'processing' sang 'segmenting')

                        // Cập nhật trạng thái trong localStorage để bền vững
                        const savedState = JSON.parse(localStorage.getItem(LOCAL_STORAGE_UPLOAD_STATE_KEY));
                        if (savedState && savedState.fileId === currentUploadFileId && savedState.jobId === jobId) {
                            savedState.processingProgress = message.progress;
                            savedState.processingStatus = message.status;
                            savedState.timestamp = Date.now();
                            localStorage.setItem(LOCAL_STORAGE_UPLOAD_STATE_KEY, JSON.stringify(savedState));
                            setResumeState(savedState); // Cập nhật resumeState
                            // setStatusMessage(`Tiến trình Video Processing: ${Math.round(message.progress)}% - ${message.status || 'Đang xử lý...'}`); // Có thể cập nhật status message ở đây nếu muốn
                        }


                        // Nếu xử lý video hoàn thành (hoặc thất bại), dọn dẹp và reset UI
                        if (message.status === 'completed' || message.status === 'failed') {
                            console.log(`Job ${jobId} finished with status: ${message.status}`);
                            // Xóa trạng thái hoàn toàn khỏi local storage và indexeddb
                            // clearLocalJobState sẽ xóa local state và đóng socket
                            clearLocalJobState(currentUploadFileId); // Clear state cục bộ VÀ đóng socket

                            // Giữ lại tiến trình processing cuối cùng để hiển thị 100% hoặc failed
                            // selectedFile cũng giữ lại để user xem lại tên file (handleFileChange không reset selectedFile nếu uiState != initial)

                            // Cập nhật trạng thái UI cuối cùng
                            setVideoProcessingStatus(message.status); // Ensure final status is set for display
                            setUiState('finished'); // Cập nhật trạng thái UI là đã hoàn thành/thất bại
                            setStatusMessage(`Video Processing ${message.status}! Job ID: ${jobId}`); // Cập nhật thông báo cuối cùng


                            // Đóng WebSocket sau khi nhận tin cuối cùng (đã xử lý trong clearLocalJobState)
                            // setTimeout(() => { ... }, 1000); // Not needed if clearLocalJobState closes immediately

                        }

                    } else {
                        console.log("Received irrelevant or malformed WebSocket message:", message);
                    }

                } catch (e) {
                    console.error("Error parsing WebSocket message:", e);
                    console.error("Raw message:", event.data);
                }
            };

            ws.onerror = (error) => {
                console.error("WebSocket error:", error);
                // Hiển thị lỗi, nhưng không xóa trạng thái localStorage ngay
                setStatusMessage(`Lỗi kết nối WebSocket: ${error.message || 'Không xác định'}. Job ID: ${jobId}.`);
                // Implement retry logic if necessary (có thể dùng setTimeout để setJobId lại)
                setUiState('processing'); // Vẫn coi là đang xử lý
            };

            ws.onclose = (event) => {
                console.log(`WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}`);
                // Xóa ref
                websocketRef.current = null;
                // Nếu đóng bất thường (không phải 1000, 1001) và chưa bị cancel, và job chưa hoàn thành/thất bại, có thể thử kết nối lại
                if (!isCancelledRef.current && event.code !== 1000 && event.code !== 1001 && videoProcessingStatus !== 'completed' && videoProcessingStatus !== 'failed') {
                    setStatusMessage(prevStatus => prevStatus + ' Mất kết nối WebSocket. Đang thử kết nối lại...');
                    console.log("WebSocket closed abnormally, attempting reconnect in a few seconds...");
                    // Retry logic example: setTimeout(() => setJobId(jobId), 5000); // Retry with the same jobId
                    setUiState('processing'); // Vẫn coi là đang xử lý
                } else if (event.code === 1000 || event.code === 1001) {
                    // Đóng bình thường sau khi hoàn thành hoặc bị cancel chủ động
                    // UI state đã được set ở handler hoàn thành hoặc cancel
                    console.log("WebSocket closed normally.");
                } else {
                    // Đóng do bị cancel bởi người dùng thông qua handleCancelUpload
                    // UI state đã được set trong handleCancelUpload
                    console.log("WebSocket closed due to cancel.");
                }
            };

            // Cleanup khi component unmount hoặc jobId thay đổi
            return () => {
                if (websocketRef.current) {
                    console.log("Closing WebSocket connection due to cleanup component or jobId change.");
                    isCancelledRef.current = true; // Đánh dấu đã cancel từ phía client
                    websocketRef.current.close();
                    websocketRef.current = null;
                }
            };
        }
        // Nếu jobId bị xóa hoặc chưa có, đảm bảo socket đóng (xử lý bởi clearLocalJobState)
        // và UI state không phải 'processing' (xử lý bởi clearLocalJobState)

    }, [jobId, videoProcessingStatus, currentUploadFileId, uiState, websocketRef, clearLocalJobState]); // Added dependencies


    // --- HANDLERS (Được trả về từ Hook) ---

    // Hàm xử lý khi người dùng chọn file
    const handleFileChange = (event) => {
        const file = event.target.files[0]; // Lấy file mà người dùng vừa chọn
        event.target.value = null; // Xóa giá trị input để cùng file có thể được chọn lại và trigger change event (quan trọng cho việc chọn lại file để resume)

        // --- Scenario: User mở dialog chọn file nhưng không chọn file nào (cancel) ---
        if (!file) {
            console.log("User cancelled file selection dialog.");
            // Nếu đang ở trạng thái chờ user chọn lại file cho resume upload
            if (uiState === 'pending_resume_select_file') {
                // Giữ nguyên trạng thái UI và thông báo
                setStatusMessage(`Đã hủy chọn file. Vui lòng chọn lại file "${resumeState.fileName}" (${Math.round((resumeState.fileSize || 0) / 1024 / 1024)} MB) để tiếp tục.`);
                // selectedFile và fileSelectedButNotMatching vẫn là null
                console.log("Stay in pending upload resume state.");
            } else if (uiState === 'resume_mismatch_choice') {
                // Nếu đang ở trạng thái lựa chọn sau khi chọn file không khớp
                setStatusMessage(`Đã hủy chọn file. Vui lòng chọn lại file "${resumeState.fileName}" để tiếp tục job cũ, hoặc nhấn "Tải lên file mới" để bắt đầu job mới.`);
                // Reset selectedFile và fileSelectedButNotMatching
                setSelectedFile(null);
                setFileSelectedButNotMatching(null);
                console.log("Stay in mismatch choice state.");
            } else if (uiState !== 'initial' && uiState !== 'finished' && !isProcessing) {
                // Đang ở một trạng thái job pending/ready nhưng không phải 2 state trên (ví dụ: ready_to_upload_new) và user cancel dialog
                // Giữ nguyên state, chỉ reset selectedFile và thông báo nếu cần
                setSelectedFile(null);
                // setStatusMessage('Chọn video để tải lên.'); // Về thông báo default nếu không có job pending
                console.log("User cancelled file selection dialog while in a ready/pending state.");
            }
            // Các trạng thái khác (initial, processing, finished) không cần xử lý đặc biệt khi cancel dialog
            return; // Dừng xử lý nếu không có file

        }

        // --- Scenario: User CHỌN MỘT FILE ---

        // Tính toán ID đơn giản (tên-kích thước) để so sánh với trạng thái resume upload
        const potentialFileMatchId = `${file.name}-${file.size}`;
        // Kiểm tra xem file mới chọn có khớp với file trong trạng thái resume upload đang chờ không
        const isMatchWithPendingResumeUpload = resumeState && resumeState.status === 'uploading' && resumeState.fileId && resumeState.fileId.startsWith(potentialFileMatchId);


        if (isMatchWithPendingResumeUpload) {
            // --- Scenario 1: File mới chọn KHỚP với trạng thái resume upload đang chờ ---
            console.log("Selected file matches pending upload resume state.");

            // Reset fileSelectedButNotMatching (đảm bảo không còn file không khớp nào trong state)
            setFileSelectedButNotMatching(null);
            // Set file mới chọn vào state selectedFile
            setSelectedFile(file);

            // Các state upload (uploadedChunks, totalChunks, uploadProgress) đã được set bởi effect lúc mount từ resumeState
            // currentUploadFileId cũng đã được set bởi effect từ resumeState
            // resumeState được giữ nguyên để logic handleUpload biết cần resume

            // Cập nhật thông báo và trạng thái UI
            setStatusMessage(
                `Đã chọn lại file "${file.name}". Chuẩn bị tiếp tục tải lên từ chunk ${uploadedChunks}. Nhấn "Tiếp tục Tải lên".`
            );
            setUiState('ready_to_resume_upload'); // Sẵn sàng tiếp tục

            // Đảm bảo các state liên quan đến processing được reset nếu job cũ chưa hoàn thành processing (ít xảy ra scenario này)
            setJobId(null);
            setVideoProcessingProgress(0);
            setVideoProcessingStatus('');


        } else {
            // --- Scenario 2: File mới chọn KHÔNG KHỚP với trạng thái resume upload đang chờ (HOẶC không có trạng thái resume upload nào) ---
            console.log("Selected file does NOT match pending upload resume state, or no state exists.");

            // Set selectedFile và fileSelectedButNotMatching với file mới được chọn
            setSelectedFile(file);
            setFileSelectedButNotMatching(file); // Lưu file không khớp vào state riêng

            // Thông báo rõ ràng cho người dùng về sự không khớp và các lựa chọn
            if (resumeState && (resumeState.status === 'uploading' || resumeState.status === 'processing')) {
                // Có trạng thái dang dở (uploading hoặc processing) nhưng file chọn không khớp
                setStatusMessage(
                    `Bạn đã chọn file "${file.name}" (${(file.size / 1024 / 1024).toFixed(2)} MB). ` +
                    `Đây không phải file "${resumeState.fileName}" (${(resumeState.fileSize / 1024 / 1024).toFixed(2)} MB) đang dang dở (Job ID: ${resumeState.jobId || resumeState.fileId}). ` +
                    `Chọn "Tải lên file mới" để tải file này, đồng thời hủy bỏ job cũ. Hoặc chọn lại file "${resumeState.fileName}" để tiếp tục job cũ.`
                );
                setUiState('resume_mismatch_choice'); // Đang ở trạng thái lựa chọn sau khi không khớp
                console.log("Detected file mismatch. UI state updated to mismatch choice. Old state preserved.");
            } else {
                // Không có bất kỳ trạng thái resume nào từ đầu -> chỉ là chọn file mới lần đầu
                // Reset các state upload chunk (không ảnh hưởng resumeState/jobId nếu có job processing dang dở)
                setUploadProgress(0);
                setIsUploading(false);
                setIsCompletingUpload(false);
                setUploadedChunks(0);
                setTotalChunks(0);
                // currentUploadFileId, jobId, resumeState giữ nguyên nếu đang processing
                // Nếu không có job gì cả, các state này đã là null rồi

                setStatusMessage(`Đã chọn file: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB). Nhấn Tải lên.`);
                setUiState('ready_to_upload_new'); // Sẵn sàng tải lên file mới

                console.log("No pending resume state found. UI state set to ready_to_upload_new.");

            }


        }
    };

    // Hàm xử lý khi người dùng nhấn nút Cancel (Chỉ hiển thị modal xác nhận)
    const handleCancelUpload = () => { // <-- Không còn async và không thực hiện logic hủy trực tiếp
        console.log("User clicked Cancel. Showing confirmation modal.");
        setShowCancelConfirmModal(true); // <-- Hiển thị modal xác nhận
    };

    // Hàm xử lý khi người dùng nhấn nút "Chọn lại file X" (sau khi chọn file không khớp)
    // Chỉ đơn giản là reset selectedFile và fileSelectedButNotMatching để input file sẵn sàng chọn lại
    const handleSelectOriginalFile = () => {
        console.log("User chose to select original file.");
        setSelectedFile(null); // Xóa file không khớp khỏi state selectedFile
        setFileSelectedButNotMatching(null); // Xóa file không khớp khỏi state tạm
        // UI state vẫn là 'resume_mismatch_choice', chuyển về 'pending_resume_select_file' để gợi ý chọn lại
        setUiState('pending_resume_select_file');
        setStatusMessage(`Vui lòng chọn lại file "${resumeState.fileName}" để tiếp tục job cũ.`); // Gợi ý rõ ràng
    };

    // Hàm đóng modal xác nhận hủy
    const dismissCancelModal = () => { // <-- Hàm mới để đóng modal
        console.log("Dismissing cancel confirmation modal.");
        setShowCancelConfirmModal(false);
        // Giữ nguyên trạng thái UI trước khi modal hiển thị
    };

    // Hàm xác nhận hủy (Chạy khi nhấn nút "Có" trong modal Hủy)
    const confirmCancel = async () => { // <-- Hàm mới thực hiện logic hủy thực sự
        console.log("User confirmed cancellation. Performing cancel logic.");
        // Ẩn modal trước khi thực hiện logic
        setShowCancelConfirmModal(false);

        // Lấy jobIdentifier của job đang active/resume/pending để báo hủy server và xóa local DB
        let jobIdentifierToCancel = resumeState?.jobId || resumeState?.fileId;
        let isJobIdToCancel = !!resumeState?.jobId; // Xác định xem định danh là jobId hay fileId

        if (jobIdentifierToCancel) {
            console.log(`Cancelling job ${jobIdentifierToCancel} on server.`);
            // Gửi yêu cầu hủy job lên server
            await cancelJobOnServer(jobIdentifierToCancel, isJobIdToCancel);
        } else {
            console.log("No active job to cancel on server.");
        }

        // Dọn dẹp toàn bộ trạng thái và dữ liệu job đang active/resume
        // clearLocalJobState sẽ xử lý xóa localStorage, IndexedDB, đóng WebSocket, và reset state job-related
        // Chúng ta truyền fileId tương ứng để đảm bảo xóa đúng file khỏi IndexedDB
        await clearLocalJobState(resumeState?.fileId); // Sử dụng resumeState?.fileId để đảm bảo xóa đúng file của job đó


        // Reset toàn bộ UI và state về trạng thái ban đầu
        resetUploader();
        setStatusMessage("Quá trình đã bị hủy bởi người dùng."); // Thông báo cuối cùng sau khi hủy và reset

    };

    // *** Hàm xử lý khi người dùng nhấn nút "Tải lên file mới" (Hiển thị modal xác nhận) ***
    // Hàm này chỉ hiển thị modal xác nhận tải mới/hủy cũ
    const handleUploadNewAndCancelOld = () => { // <-- Không còn async và không thực hiện logic trực tiếp
        console.log("User clicked Upload New. Showing confirmation modal.");
        // File mới được chọn đã được lưu trong state selectedFile và fileSelectedButNotMatching
        // selectedFile phải giữ file mới ở trạng thái resume_mismatch_choice
        if (!selectedFile) {
            console.error("handleUploadNewAndCancelOld clicked but no selectedFile!");
            setStatusMessage("Lỗi: Không tìm thấy file mới để tải lên.");
            resetUploader(); // Về trạng thái ban đầu
            return;
        }
        // Hiển thị modal xác nhận tải mới/hủy cũ
        setShowUploadNewConfirmModal(true); // <-- Hiển thị modal xác nhận
    };

    // Hàm đóng modal xác nhận tải mới/hủy cũ
    const dismissUploadNewModal = () => { // <-- Hàm mới để đóng modal
        console.log("Dismissing upload new confirmation modal.");
        setShowUploadNewConfirmModal(false);
        // Giữ nguyên trạng thái UI trước khi modal hiển thị (resume_mismatch_choice)
    };

    // Hàm xác nhận tải mới và hủy cũ (Chạy khi nhấn nút "Có" trong modal Tải mới)
    const confirmUploadNewAndCancelOld = async () => { // <-- Hàm mới thực hiện logic
        console.log("User confirmed upload new and cancel old job.");
        // Ẩn modal trước khi thực hiện logic
        setShowUploadNewConfirmModal(false);

        // selectedFile phải giữ file mới ở trạng thái resume_mismatch_choice
        if (!selectedFile) {
            console.error("confirmUploadNewAndCancelOld called but no selectedFile!");
            setStatusMessage("Lỗi: Không tìm thấy file mới để tải lên.");
            resetUploader(); // Về trạng thái ban đầu
            return;
        }
        // File mới được chọn để upload chính là selectedFile.
        // fileSelectedButNotMatching chỉ là bản copy tạm, giờ không cần nữa.

        // *** Bước 1: Hủy bỏ job cũ (nếu có) ***
        // Lấy jobIdentifier của job cũ từ resumeState trước khi xóa nó
        let oldJobIdentifierToCancel = resumeState?.jobId || resumeState?.fileId;
        let isOldJobId = !!resumeState?.jobId;

        if (oldJobIdentifierToCancel) {
            console.log(`Cancelling old job ${oldJobIdentifierToCancel} before starting new one.`);
            // Gửi yêu cầu hủy job cũ lên server
            await cancelJobOnServer(oldJobIdentifierToCancel, isOldJobId);
            // Dọn dẹp local state của job cũ (localStorage, IndexedDB)
            // clearLocalJobState cần fileId của job cũ để xóa file trong DB
            await clearLocalJobState(resumeState.fileId); // fileId của job cũ nằm trong resumeState.fileId
        } else {
            console.log("No old job to cancel.");
            // Nếu không có job cũ (resumeState null), chỉ cần đảm bảo UI sạch (resetUploader sẽ làm việc này)
            // và proceed start new upload.
        }

        // *** Bước 2: Bắt đầu quá trình upload file mới ***
        // Sau khi clearLocalJobState, các state job cũ đã null (resumeState, currentUploadFileId, jobId).
        // selectedFile đang giữ file mới cần upload.
        // Chúng ta sẽ gọi hàm handleUpload để bắt đầu quá trình upload mới cho selectedFile.

        // Cập nhật status message ban đầu cho việc upload mới
        setStatusMessage(`Đang chuẩn bị tải lên file "${selectedFile.name}"...`);
        // uiState sẽ được set sang 'uploading' trong handleUpload
        // setUiState('ready_to_upload_new'); // Không cần set ở đây, handleUpload sẽ set 'uploading'

        // Reset các state upload chunk (không ảnh hưởng selectedFile)
        setUploadProgress(0);
        setUploadedChunks(0);
        setTotalChunks(0);
        setIsUploading(false);
        setIsCompletingUpload(false);


        // Gọi handleUpload để bắt đầu quá trình upload mới
        // handleUpload sẽ nhận selectedFile, tạo fileId mới, lưu DB, lưu localStorage, và bắt đầu vòng lặp gửi chunk
        handleUpload(); // selectedFile đã được set, nó sẽ được dùng

        // Reset fileSelectedButNotMatching sau khi đã xử lý nó
        setFileSelectedButNotMatching(null);

    };


    // Hàm xử lý khi người dùng nhấn nút Tải lên / Tiếp tục Tải lên
    // Hàm này chỉ được gọi khi UI ở trạng thái 'ready_to_upload_new' hoặc 'ready_to_resume_upload'
    const handleUpload = async () => {
        // --- Kiểm tra xem có phải attempt resume upload hợp lệ không ---
        // Resume attempt hợp lệ khi: có resumeState 'uploading', selectedFile đã được chọn VÀ selectedFile khớp với resumeState
        const isResumeUploadAttempt = resumeState && resumeState.status === 'uploading' && selectedFile && resumeState.fileId.startsWith(`${selectedFile.name}-${selectedFile.size}`);


        // selectedFile phải có giá trị ở các state gọi hàm này
        if (!selectedFile) {
            console.error("handleUpload called but no selectedFile!");
            setStatusMessage('Lỗi hệ thống. Vui lòng chọn lại video.');
            resetUploader();
            return;
        }


        setIsUploading(true); // Bắt đầu trạng thái upload chunk
        setIsCompletingUpload(false);
        isCancelledRef.current = false; // Đảm bảo flag cancel là false cho lần upload này

        // Xác định fileId cho lần upload này và file Blob/File object để làm việc.
        let fileToUpload = selectedFile; // Luôn dùng selectedFile ở đây
        let uploadFileId = currentUploadFileId; // Sẽ là null nếu bắt đầu mới, hoặc ID cũ nếu resume
        let startingChunkIndex = 0; // Bắt đầu từ chunk 0 nếu upload mới
        let calculatedTotalChunks = 0;

        // --- Logic xác định có phải tiếp tục upload dang dở không ---
        if (isResumeUploadAttempt) {
            // Scenario: Đang tiếp tục upload dang dở VÀ user đã chọn lại đúng file
            uploadFileId = resumeState.fileId; // Sử dụng lại fileId đã lưu từ resumeState
            startingChunkIndex = resumeState.lastChunkIndex + 1; // Bắt đầu từ chunk kế tiếp
            // Tính lại totalChunks dựa trên file mới chọn lại (đã khớp tên/kích thước với resumeState)
            calculatedTotalChunks = Math.ceil(fileToUpload.size / CHUNK_SIZE);
            // Cập nhật state tiến trình ban đầu dựa trên chunk bắt đầu
            setUploadedChunks(startingChunkIndex);
            setTotalChunks(calculatedTotalChunks);
            setUploadProgress(Math.round(startingChunkIndex / calculatedTotalChunks * 100));
            setStatusMessage(`Tiếp tục tải lên file "${fileToUpload.name}" từ chunk ${startingChunkIndex + 1}...`);
            setCurrentUploadFileId(uploadFileId); // Đảm bảo currentUploadFileId được set đúng cho resume
            setUiState('uploading'); // Cập nhật trạng thái UI

            // Lấy lại Blob từ IndexedDB để sử dụng cho việc cắt slice
            try {
                const resumedBlob = await getFileFromDB(uploadFileId);
                if (resumedBlob) {
                    // Gán Blob đã lấy lại vào biến sẽ dùng để slice.
                    // Tạo lại File object từ Blob để có name, size, type properties nếu cần (slice hoạt động trên Blob/File)
                    fileToUpload = new File([resumedBlob], resumeState.fileName, { type: resumedBlob.type, lastModified: resumeState.timestamp || Date.now() }); // Sử dụng thông tin lưu trữ
                    console.log("Đã khôi phục File Blob from IndexedDB for resume.");
                } else {
                    // Trường hợp không tìm thấy file trong DB dù localStorage nói có (lỗi dữ liệu không nhất quán)
                    console.error("Lỗi khôi phục: Không tìm thấy file Blob trong IndexedDB cho resume.");
                    setStatusMessage("Lỗi khôi phục file. Vui lòng bắt đầu tải lên mới.");
                    // Dọn dẹp trạng thái resume lỗi và reset
                    handleCancelUpload(); // Hủy bỏ quá trình resume lỗi và reset UI
                    return; // Dừng hàm
                }
            } catch (e) {
                console.error("Lỗi khi lấy file từ IndexedDB để resume:", e);
                setStatusMessage("Lỗi khôi phục file. Vui lòng bắt đầu tải lên mới.");
                // Dọn dọn trạng thái resume lỗi và reset
                handleCancelUpload(); // Hủy bỏ quá trình resume lỗi và reset UI
                return; // Dừng hàm
            }

        } else {
            // Scenario: Bắt đầu quá trình upload mới (Không phải resume hợp lệ)
            // selectedFile đã được set trong handleFileChange và clearAllJobState đã chạy nếu cần bởi logic ở đầu handleUploadNewAndCancelOld
            if (!selectedFile) { // Double check nếu không ở trạng thái resume mà selectedFile lại null
                setStatusMessage('Lòng chọn một file video.'); // Should not happen due to check at function start
                setIsUploading(false);
                return;
            }
            // clearLocalJobState đã chạy trước khi gọi handleUpload (nếu cần) và đã set state về initial/clean
            // nên các state job cũ (resumeState, currentUploadFileId, jobId) đã là null

            // Tạo fileId mới cho lần upload này. Sử dụng name-size-timestamp để đảm bảo tính duy nhất cho mỗi LẦN BẮT ĐẦU upload mới.
            uploadFileId = `${fileToUpload.name}-${fileToUpload.size}-${Date.now()}`;
            setCurrentUploadFileId(uploadFileId); // Lưu vào state
            startingChunkIndex = 0;
            calculatedTotalChunks = Math.ceil(fileToUpload.size / CHUNK_SIZE);
            setTotalChunks(calculatedTotalChunks);
            setUploadedChunks(0);
            setUploadProgress(0);
            setStatusMessage(`Đang chuẩn bị tải lên file "${fileToUpload.name}"...`);
            setUiState('uploading'); // Cập nhật trạng thái UI

            // *** Lưu file Blob vào IndexedDB ngay khi bắt đầu upload mới ***
            try {
                await saveFileToDB(uploadFileId, fileToUpload);
                console.log(`File ${uploadFileId} đã lưu vào IndexedDB.`);
            } catch (e) {
                console.error(`Lỗi khi lưu file ${uploadFileId} vào IndexedDB:`, e);
                setStatusMessage(`Lỗi khi lưu file vào bộ nhớ cục bộ: ${e.message}. Không thể tiếp tục nếu bị gián đoạn.`);
                // Có thể chọn dừng upload hoặc cho phép tiếp tục nhưng không có resume
            }

            // *** Lưu trạng thái upload ban đầu vào localStorage ***
            const initialUploadState = {
                fileId: uploadFileId,
                lastChunkIndex: -1, // Bắt đầu từ trước chunk 0
                fileName: fileToUpload.name,
                fileSize: fileToUpload.size,
                totalChunks: calculatedTotalChunks,
                status: 'uploading', // Đánh dấu trạng thái đang upload
                timestamp: Date.now()
            };
            localStorage.setItem(LOCAL_STORAGE_UPLOAD_STATE_KEY, JSON.stringify(initialUploadState));
            setResumeState(initialUploadState); // Cập nhật resumeState để logic sau này biết
        }


        console.log(`File ID cho upload: ${uploadFileId}, Bắt đầu từ chunk: ${startingChunkIndex}`);
        console.log(`Tổng số chunk: ${calculatedTotalChunks}`);


        let chunkIndex = startingChunkIndex;
        let uploadedSize = chunkIndex * CHUNK_SIZE; // Kích thước đã upload ban đầu


        // Vòng lặp để gửi từng chunk
        while (chunkIndex < calculatedTotalChunks && !isCancelledRef.current) { // Thêm điều kiện kiểm tra cancel
            const start = chunkIndex * CHUNK_SIZE; // SỬA LỖI: CCHUNK_SIZE -> CHUNK_SIZE
            const end = Math.min(start + CHUNK_SIZE, fileToUpload.size);
            const chunk = fileToUpload.slice(start, end); // Sử dụng đối tượng File/Blob đã xác định

            const formData = new FormData();
            formData.append('file', chunk); // Thêm chunk vào FormData
            formData.append('fileId', uploadFileId); // Thêm ID duy nhất của file
            formData.append('chunkIndex', chunkIndex);

            try {
                setStatusMessage(`Đang tải lên chunk ${chunkIndex + 1} / ${calculatedTotalChunks}...`);

                const response = await fetch(UPLOAD_CHUNK_API_URL, {
                    method: 'POST',
                    body: formData,
                    // Headers có thể cần nếu server yêu cầu xác thực, v.v.
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Lỗi tải lên chunk ${chunkIndex + 1}: ${response.status} - ${errorText}`);
                }

                console.log(`Chunk ${chunkIndex} tải lên thành công`);

                uploadedSize += chunk.size; // Cập nhật tổng kích thước đã upload
                const currentUploadProgress = (uploadedSize / fileToUpload.size) * 100;

                // *** Cập nhật trạng thái trong localStorage sau mỗi chunk thành công ***
                const updatedUploadState = {
                    fileId: uploadFileId,
                    lastChunkIndex: chunkIndex, // Lưu index của chunk VỪA XONG
                    fileName: fileToUpload.name,
                    fileSize: fileToUpload.size,
                    totalChunks: calculatedTotalChunks,
                    status: 'uploading',
                    timestamp: Date.now()
                };
                localStorage.setItem(LOCAL_STORAGE_UPLOAD_STATE_KEY, JSON.stringify(updatedUploadState));
                setResumeState(updatedUploadState); // Cập nhật resumeState
                setUploadedChunks(chunkIndex + 1); // Cập nhật state số chunk đã upload

                // Cập nhật tiến trình tổng thể, giữ dưới 100%
                setUploadProgress(currentUploadProgress > 99 ? 99 : currentUploadProgress);

                chunkIndex++; // Chuyển sang chunk tiếp theo

            } catch (error) {
                // Xử lý lỗi (mất mạng, lỗi server, ...)
                console.error(`Lỗi khi tải lên chunk ${chunkIndex + 1}:`, error);
                setIsUploading(false); // Dừng trạng thái tải lên
                // Hiển thị thông báo lỗi chi tiết
                setStatusMessage(`Lỗi khi tải lên chunk ${chunkIndex + 1}: ${error instanceof Error ? error.message : String(error)}. ` +
                    `Trạng thái đã được lưu. Vui lòng kiểm tra mạng và nhấn "Tiếp tục Tải lên" để thử lại.`);
                // Trạng thái localStorage đã được lưu ở chunk thành công cuối cùng
                // resumeState đã được cập nhật
                setUiState('ready_to_resume_upload'); // Chuyển UI về trạng thái sẵn sàng tiếp tục
                return; // Dừng vòng lặp nếu có lỗi
            }
        }

        // Kiểm tra xem vòng lặp kết thúc do hoàn thành hay bị cancel
        if (isCancelledRef.current) {
            setStatusMessage("Tải lên đã bị hủy.");
            setIsUploading(false); // Đảm bảo state được cập nhật
            // uiState đã được set trong handleCancelUpload (resetUploader)
            return; // Kết thúc hàm nếu bị cancel
        }

        // Khi vòng lặp gửi chunk kết thúc thành công (đã gửi hết chunk)
        setIsUploading(false); // Kết thúc trạng thái upload chunk
        setIsCompletingUpload(true); // Bắt đầu trạng thái gửi yêu cầu hoàn thành
        setStatusMessage('Đang hoàn tất quá trình tải lên...');
        setUiState('completing'); // Cập nhật trạng thái UI


        // Gửi yêu cầu hoàn thành upload đến server
        try {
            // Sử dụng hàm completeUpload từ api.js
            const receivedJobId = await completeUpload(uploadFileId, calculatedTotalChunks, fileToUpload.name);


            // *** Nhận job ID VÀ CẬP NHẬT TRẠNG THÁI localStorage SANG PROCESSING ***
            if (receivedJobId) {
                // *** Xóa file Blob khỏi IndexedDB sau khi upload hoàn tất thành công ***
                try {
                    await deleteFileFromDB(uploadFileId);
                    console.log(`File ${uploadFileId} đã xóa khỏi IndexedDB after upload complete.`);
                } catch (e) {
                    console.error(`Lỗi khi xóa file ${uploadFileId} khỏi IndexedDB after upload complete:`, e);
                    // Lỗi xóa DB không ngăn cản tiến trình tiếp theo, chỉ là tốn bộ nhớ client
                }

                // *** Cập nhật trạng thái localStorage sang Processing ***
                const processingState = {
                    fileId: uploadFileId,
                    fileName: fileToUpload.name,
                    fileSize: fileToUpload.size,
                    jobId: receivedJobId,
                    status: 'processing', // Đánh dấu trạng thái đang xử lý video
                    processingProgress: 0, // Reset tiến trình processing
                    processingStatus: '', // Reset trạng thái processing
                    timestamp: Date.now()
                };
                localStorage.setItem(LOCAL_STORAGE_UPLOAD_STATE_KEY, JSON.stringify(processingState));
                setResumeState(processingState); // Cập nhật state resume

                setJobId(receivedJobId); // <-- Cập nhật state jobId -> Kích hoạt useEffect mở WebSocket
                setUploadProgress(100); // Hoàn thành tiến trình upload HTTP visual
                setStatusMessage(`Tải lên file hoàn tất! Bắt đầu theo dõi tiến trình video processing for Job ID: ${receivedJobId}`);
                setVideoProcessingProgress(0); // Reset tiến trình processing visual
                setVideoProcessingStatus('Đang chờ bắt đầu xử lý...'); // Cập nhật trạng thái ban đầu cho processing
                setUiState('processing'); // Cập nhật trạng thái UI


            } else {
                // Trường hợp API hoàn tất không ném lỗi nhưng trả về jobId rỗng/null
                throw new Error("Complete upload API did not return a valid Job ID.");
            }

        } catch (error) {
            // Xử lý lỗi khi gọi API hoàn tất upload
            console.error('Lỗi khi hoàn tất upload:', error);
            setStatusMessage(`Lỗi khi hoàn tất upload: ${error instanceof Error ? error.message : String(error)}. Vui lòng thử lại hoặc chọn file khác.`);
            setIsCompletingUpload(false); // Dừng trạng thái hoàn tất

            // Giữ lại trạng thái localStorage (vẫn là 'uploading' 100%) để user có thể thử lại API hoàn tất
            // Nếu user chọn file khác, trạng thái này sẽ bị clear bởi handleFileChange
            // Nếu user refresh, trạng thái này sẽ được tải lại và có thể hiển thị đã 100% upload HTTP, chờ hoàn tất.
            // Có thể thêm nút "Thử lại hoàn tất" nếu muốn xử lý chi tiết hơn.
            setUiState('ready_to_upload_new'); // Chuyển UI về trạng thái sẵn sàng tải lên mới (có thể thử lại)


        } finally {
            // Dù thành công hay thất bại ở bước hoàn tất API, set isCompletingUpload về false
            setIsCompletingUpload(false);
        }
    };

    // --- Điều kiện hiển thị UI (được trả về từ Hook) ---
    // Nút "Tải lên" (bắt đầu mới) - Hiển thị khi UI ở trạng thái initial hoặc ready_to_upload_new
    const showUploadNewButton = uiState === 'initial' || uiState === 'ready_to_upload_new';
    // Nút "Tiếp tục Tải lên" (tiếp tục job dang dở) - Hiển thị khi UI ở trạng thái ready_to_resume_upload
    const showResumeUploadButton = uiState === 'ready_to_resume_upload';
    // Nút "Tải lên file mới" (trong luồng lựa chọn sau khi không khớp) - Hiển thị khi UI ở trạng thái resume_mismatch_choice
    const showUploadNewAndCancelOldButton = uiState === 'resume_mismatch_choice'; // && fileSelectedButNotMatching !== null; // fileSelectedButNotMatching luôn != null ở state này
    // Nút "Chọn lại file X" (trong luồng lựa chọn sau khi không khớp) - Hiển thị khi UI ở trạng thái resume_mismatch_choice
    const showSelectOriginalButton = uiState === 'resume_mismatch_choice';
    // Nút "Hủy" - Hiển thị khi có bất kỳ quá trình nào đang diễn ra HOẶC có trạng thái resume/job đang lưu, TRỪ khi UI ở initial hoặc finished
    const showCancelButton = uiState !== 'initial' && uiState !== 'finished';

    // File hiển thị tên trong label chọn file
    // Ưu tiên hiển thị fileSelectedButNotMatching nếu đang ở trạng thái mismatch_choice
    const fileToDisplayInLabel = uiState === 'resume_mismatch_choice' ? fileSelectedButNotMatching : selectedFile;

    // Trạng thái tổng thể đang xử lý (uploading chunks, completing, processing)
    const isProcessing = isUploading || isCompletingUpload || (uiState === 'processing');


    // Trả về tất cả state và handlers mà component cần
    return {
        // States
        selectedFile,
        fileSelectedButNotMatching,
        uploadProgress,
        isUploading,
        isCompletingUpload,
        uploadedChunks,
        totalChunks,
        currentUploadFileId,
        jobId,
        videoProcessingProgress,
        videoProcessingStatus,
        resumeState,
        uiState,
        statusMessage,
        showCancelConfirmModal, // <-- Trả về state modal hủy
        showUploadNewConfirmModal, // <-- Trả về state modal tải mới
        // Refs
        // websocketRef, // Hook tự quản lý WebSocket, không cần trả về ref raw
        // isCancelledRef, // Nội bộ Hook
        // Handlers
        handleFileChange,
        handleCancelUpload, // <-- Hàm chỉ hiển thị modal hủy
        handleUploadNewAndCancelOld, // <-- Hàm chỉ hiển thị modal tải mới
        handleSelectOriginalFile,
        handleUpload, // Hàm handleUpload từ Hook
        confirmCancel, // <-- Hàm xác nhận hủy thực sự
        dismissCancelModal, // <-- Hàm đóng modal hủy
        confirmUploadNewAndCancelOld, // <-- Hàm xác nhận tải mới thực sự
        dismissUploadNewModal, // <-- Hàm đóng modal tải mới
        // Computed values for UI
        showUploadNewButton,
        showResumeUploadButton,
        showUploadNewAndCancelOldButton,
        showSelectOriginalButton,
        showCancelButton,
        fileToDisplayInLabel,
        isProcessing // Trả về trạng thái xử lý tổng quát nếu cần
    };
};

export default useUploaderLogic;