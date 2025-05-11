import React from 'react';
import VideoUploader from './VideoUploader';
import HlsVideoPlayer from "./HlsVideoPlayer";

function App() {
  return (
      <div className="App">
        <VideoUploader />
        {/*  <HlsVideoPlayer src="http://localhost:8080/videos/b0681757-06f9-459e-9d92-221aedff2e99_sample/360p/stream.m3u8"/>*/}
      </div>
  );
}

export default App;