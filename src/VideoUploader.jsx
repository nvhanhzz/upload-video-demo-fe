// src/VideoUploader.jsx

import React from 'react';
import './VideoUploader.css'; // Import file CSS
import useUploaderLogic from './useUploaderLogic'; // Import Custom Hook

function VideoUploader() {
    // Sử dụng Custom Hook để lấy tất cả trạng thái và hàm xử lý
    const {
        // States
        selectedFile,
        fileSelectedButNotMatching, // Dùng để hiển thị tên file trong modal nếu hủy từ trạng thái mismatch_choice
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
        showCancelConfirmModal, // <-- Lấy state modal hủy
        showUploadNewConfirmModal, // <-- Lấy state modal tải mới
        // Refs (Hook tự quản lý)
        // Handlers
        handleFileChange,
        handleCancelUpload, // <-- Hàm chỉ hiển thị modal hủy
        handleUploadNewAndCancelOld, // <-- Hàm chỉ hiển thị modal tải mới
        handleSelectOriginalFile,
        handleUpload, // Hàm handleUpload từ Hook (bắt đầu/tiếp tục upload)
        confirmCancel, // <-- Lấy hàm xác nhận hủy thực sự
        dismissCancelModal, // <-- Lấy hàm đóng modal hủy
        confirmUploadNewAndCancelOld, // <-- Lấy hàm xác nhận tải mới thực sự
        dismissUploadNewModal, // <-- Lấy hàm đóng modal tải mới
        // Computed values for UI
        showUploadNewButton,
        showResumeUploadButton,
        showUploadNewAndCancelOldButton,
        showSelectOriginalButton,
        showCancelButton,
        fileToDisplayInLabel, // File object để hiển thị tên
        isProcessing // Trạng thái xử lý tổng quát từ Hook
    } = useUploaderLogic(); // Gọi Hook

    // Logic WebSocket useEffect đã chuyển vào useUploaderLogic


    // Xác định tên file sẽ bị hủy (để hiển thị trong modal Hủy)
    const fileToCancelName = resumeState?.fileName || fileToDisplayInLabel?.name || 'job hiện tại';
    const jobIdentifierToCancel = resumeState?.jobId || resumeState?.fileId || currentUploadFileId || 'job hiện tại'; // Lấy job ID để hiển thị trong modal


    return (
        <div className="video-uploader-container">
            <h1>Tải lên Video (Resume & Processing)</h1>

            {/* Khu vực chọn file */}
            <div className="file-input-area">
                {/*
                  Input file disable khi:
                  - Đang upload (isUploading, isCompletingUpload)
                  - Đang xử lý processing (uiState === 'processing')
                  - Đang ở trạng thái lựa chọn sau khi không khớp (uiState === 'resume_mismatch_choice')
                */}
                <input
                    type="file"
                    accept="video/*"
                    onChange={handleFileChange} // Handler từ Hook
                    // Disable input khi đang xử lý (uploading/completing/processing),
                    // hoặc đang ở trạng thái lựa chọn sau khi không khớp (trừ khi nhấn Chọn lại)
                    // Cho phép click input ở các state: initial, pending_resume_select_file, ready_to_upload_new, ready_to_resume_upload, finished
                    // Disable ở các state: uploading, completing, processing, resume_mismatch_choice
                    disabled={isUploading || isCompletingUpload || (uiState === 'processing') || (uiState === 'resume_mismatch_choice')}
                    className="file-input"
                    id="videoFileInput"
                />
                <label htmlFor="videoFileInput">
                    {/* Hiển thị thông báo hướng dẫn chọn lại file khi ở trạng thái chờ user chọn lại file resume */}
                    {uiState === 'pending_resume_select_file' && resumeState && ( // Kiểm tra resumeState
                        <span className="resume-instruction-message">
                             Tìm thấy upload dang dở. Vui lòng chọn lại file "${resumeState.fileName}" ({Math.round((resumeState.fileSize || 0) / 1024 / 1024)} MB) để tiếp tục.
                         </span>
                    )}
                    {/* Hiển thị tên file đã chọn nếu có file (fileToDisplayInLabel được tính trong Hook) */}
                    {fileToDisplayInLabel && (
                        <span className="selected-file-name-display">
                             Đã chọn: "{fileToDisplayInLabel.name}" ({((fileToDisplayInLabel.size || 0) / 1024 / 1024).toFixed(2)} MB)
                         </span>
                    )}
                    {/* Hiển thị text mặc định nếu chưa chọn file và không ở các trạng thái chờ chọn lại */}
                    {!fileToDisplayInLabel && uiState === 'initial' && (
                        <span>Nhấp vào đây để chọn video</span>
                    )}
                    {/* Hiển thị text mặc định cho các trạng thái khác khi chưa chọn file và không phải state chờ chọn lại file resume */}
                    {!fileToDisplayInLabel && uiState !== 'initial' && uiState !== 'pending_resume_select_file' && (
                        <span>Nhấp vào đây để chọn video</span> // Vẫn cho phép chọn file khác trong các state khác
                    )}
                </label>
            </div>

            {/* Khu vực nút hành động */}
            <div className="action-button-area">
                {/* Nút "Tải lên" (bắt đầu mới) */}
                {showUploadNewButton && ( // Điều kiện hiển thị từ Hook
                    <button onClick={handleUpload} disabled={isProcessing}> {/* Handler và disabled từ Hook */}
                        Tải lên
                    </button>
                )}

                {/* Nút "Tiếp tục Tải lên" (tiếp tục job dang dở) */}
                {showResumeUploadButton && ( // Điều kiện hiển thị từ Hook
                    <button onClick={handleUpload} disabled={isProcessing}> {/* Handler và disabled từ Hook */}
                        Tiếp tục Tải lên
                    </button>
                )}

                {/* Nút "Tải lên file mới" (trong luồng lựa chọn sau khi không khớp) */}
                {showUploadNewAndCancelOldButton && ( // Điều kiện hiển thị từ Hook
                    <button onClick={handleUploadNewAndCancelOld} disabled={isProcessing} className="cancel-button"> {/* Handler từ Hook (hiển thị modal) */}
                        Tải lên file mới
                    </button>
                )}

                {/* Nút "Chọn lại file X" (trong luồng lựa chọn sau khi không khớp) */}
                {showSelectOriginalButton && resumeState && ( // Điều kiện hiển thị từ Hook, cần thêm check resumeState
                    <button onClick={handleSelectOriginalFile} disabled={isProcessing}> {/* Handler từ Hook */}
                        Chọn lại file cũ
                    </button>
                )}


                {/* Nút Hủy - Hiển thị khi có bất kỳ quá trình nào đang diễn ra HOẶC có trạng thái resume/job đang lưu */}
                {showCancelButton && ( // Điều kiện hiển thị từ Hook
                    <button onClick={handleCancelUpload} disabled={false} className="cancel-button"> {/* Handler từ Hook (chỉ hiển thị modal) */}
                        Hủy
                    </button>
                )}
            </div>


            {/* Hiển thị khu vực tiến trình Upload File (HTTP) */}
            {(uiState === 'uploading' || uiState === 'completing' || uploadProgress > 0 || uiState === 'pending_resume_select_file' || uiState === 'ready_to_resume_upload') && ( // Hiển thị khi có upload đang diễn ra hoặc có trạng thái upload dang dở (dựa vào uiState)
                <div className="progress-area upload-progress">
                    <h3>Tiến trình Upload File:</h3>
                    <div className="progress-bar-container">
                        <label>
                            {isCompletingUpload // State từ Hook
                                ? 'Đang hoàn tất upload...'
                                : (uiState === 'pending_resume_select_file' || (uiState === 'ready_to_resume_upload' && uploadedChunks === 0 && !isUploading)) // Nếu đang chờ chọn lại hoặc sẵn sàng resume nhưng chưa bấm upload
                                    ? `Sẵn sàng tiếp tục "${resumeState.fileName}" (${uploadedChunks}/${totalChunks})...` // State từ Hook
                                    : (isUploading || uploadedChunks > 0) // State từ Hook
                                        ? `Chunk (${uploadedChunks}/${totalChunks}): ${Math.round(uploadProgress)}%` // State từ Hook
                                        : `Sẵn sàng tải lên...` // Trạng thái ban đầu khi chọn file mới (ít khi hiển thị vì uiState khác)
                            }
                        </label>
                        <progress value={uploadProgress} max="100"></progress> {/* State từ Hook */}
                    </div>
                </div>
            )}

            {/* Hiển thị khu vực tiến trình Video Processing */}
            {(uiState === 'processing' || uiState === 'finished') && ( // Hiển thị khi trạng thái UI là processing hoặc finished
                <div className="progress-area processing-progress">
                    <h3>Tiến trình Video Processing (Job ID: {jobId || (resumeState && resumeState.jobId)}):</h3> {/* State từ Hook */}
                    <div className="progress-bar-container">
                        <label>
                            Processing: {Math.round(videoProcessingProgress)}% - {videoProcessingStatus || (resumeState && resumeState.processingStatus) || 'Đang chờ...'} {/* State từ Hook */}
                        </label>
                        <progress value={videoProcessingProgress} max="100"></progress> {/* State từ Hook */}
                    </div>
                </div>
            )}


            {/* Hiển thị thông báo trạng thái chung */}
            {statusMessage && ( // State từ Hook
                <p className={`status-message ${videoProcessingStatus}`}> {/* State từ Hook */}
                    {statusMessage} {/* State từ Hook */}
                </p>
            )}
            {/* Hiển thị thông báo cuối cùng khi processing hoàn thành (độc lập với statusMessage chính) */}
            {uiState === 'finished' && (videoProcessingStatus === 'completed' || videoProcessingStatus === 'failed') && ( // State từ Hook
                <p className={`status-message ${videoProcessingStatus}`}> {/* State từ Hook */}
                    Video Processing {videoProcessingStatus}! {/* State từ Hook */}
                </p>
            )}

            {/* --- MODAL XÁC NHẬN HỦY --- */}
            {showCancelConfirmModal && ( // <-- Hiển thị modal dựa vào state từ Hook
                <div className="modal-overlay">
                    <div className="modal-dialog">
                        <h3>Xác nhận hủy</h3>
                        <p>
                            Bạn có chắc chắn muốn hủy bỏ quá trình {uiState === 'uploading' || uiState === 'completing' ? 'tải lên file' : uiState === 'processing' ? 'xử lý video' : 'job'}
                            {jobIdentifierToCancel && ` (ID: ${jobIdentifierToCancel})`} không?
                            Hành động này sẽ xóa bỏ trạng thái lưu trữ cục bộ và file tạm trên server.
                        </p>
                        <div className="modal-actions">
                            {/* Nút "Có" -> xác nhận hủy thực sự */}
                            <button onClick={confirmCancel} className="cancel-button">Có, Hủy bỏ</button> {/* <-- Handler từ Hook */}
                            {/* Nút "Không" -> đóng modal */}
                            <button onClick={dismissCancelModal} className="select-original-button">Không</button> {/* <-- Handler từ Hook, dùng lại style nút Chọn lại */}
                        </div>
                    </div>
                </div>
            )}

            {/* --- MODAL XÁC NHẬN TẢI MỚI / HỦY CŨ --- */}
            {showUploadNewConfirmModal && fileSelectedButNotMatching && resumeState && ( // <-- Hiển thị modal dựa vào state từ Hook và đảm bảo có đủ thông tin file cũ/mới
                <div className="modal-overlay">
                    <div className="modal-dialog">
                        <h3>Xác nhận tải file mới</h3>
                        <p>
                            Bạn đã chọn file "{fileSelectedButNotMatching.name}" ({(fileSelectedButNotMatching.size / 1024 / 1024).toFixed(2)} MB).
                            File này KHÔNG khớp với job đang dang dở ("{resumeState.fileName}", ID: {resumeState.jobId || resumeState.fileId}).
                        </p>
                        <p>
                            Bạn có chắc chắn muốn **hủy bỏ job cũ** và **tải lên file mới này** không?
                            Hành động này không thể hoàn tác.
                        </p>
                        <div className="modal-actions">
                            {/* Nút "Có" -> xác nhận tải mới/hủy cũ */}
                            <button onClick={confirmUploadNewAndCancelOld} className="cancel-button">Có, Tải file mới</button> {/* <-- Handler từ Hook */}
                            {/* Nút "Không" -> đóng modal */}
                            <button onClick={dismissUploadNewModal} className="select-original-button">Không</button> {/* <-- Handler từ Hook */}
                        </div>
                    </div>
                </div>
            )}


        </div>
    );
}

export default VideoUploader;