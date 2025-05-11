import React, { useEffect, useRef } from 'react';
import Hls from 'hls.js'; // Import hls.js library

// Functional component to play HLS videos
const HlsVideoPlayer = ({ src }) => {
    // Create a ref to the video element
    const videoRef = useRef(null);
    // Create a ref to the Hls.js instance
    const hlsRef = useRef(null);

    // useEffect hook to handle Hls.js initialization and cleanup
    useEffect(() => {
        // Check if the video element is available
        if (videoRef.current) {
            // Check if Hls.js is supported by the browser
            if (Hls.isSupported()) {
                console.log('Hls.js is supported');
                // Create a new Hls.js instance
                const hls = new Hls();
                hlsRef.current = hls; // Store the instance in the ref

                // Bind Hls.js to the video element
                hls.attachMedia(videoRef.current);

                // Load the HLS manifest (stream.m3u8 or master.m3u8)
                hls.loadSource(src);

                // Listen for HLS_MEDIA_ATTACHED event
                hls.on(Hls.Events.MEDIA_ATTACHED, () => {
                    console.log('Media attached!');
                    // You can add autoplay logic here if needed
                    // videoRef.current.play();
                });

                // Listen for HLS_MANIFEST_PARSED event
                hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                    console.log('Manifest parsed:', data);
                    // You can access stream info here (data.levels)
                });

                // Handle HLS errors
                hls.on(Hls.Events.ERROR, (event, data) => {
                    console.error('Hls.js error:', data);
                    // Handle specific error types if necessary
                    if (data.fatal) {
                        switch (data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                // Try to recover network errors
                                console.error('Fatal network error encountered, trying to recover...');
                                hls.startLoad();
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                // Try to recover media errors
                                console.error('Fatal media error encountered, trying to recover...');
                                hls.recoverMediaError();
                                break;
                            default:
                                // Cannot recover, destroy Hls instance
                                hls.destroy();
                                break;
                        }
                    }
                });

            } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
                // Fallback for browsers that support HLS natively (like Safari)
                console.log('Browser supports HLS natively');
                videoRef.current.src = src;
                // You might need to add error handling for native playback here
            } else {
                console.error('HLS is not supported by your browser');
                // Display a message to the user that HLS is not supported
            }
        }

        // Cleanup function for useEffect
        return () => {
            console.log('Cleaning up Hls.js instance');
            // Destroy the Hls.js instance when the component unmounts
            if (hlsRef.current) {
                hlsRef.current.destroy();
            }
        };
    }, [src]); // Re-run effect if the 'src' prop changes

    return (
        // Video element with basic Tailwind styling
        <div className="w-full max-w-3xl mx-auto rounded-lg overflow-hidden shadow-xl">
            <video
                ref={videoRef} // Attach the ref to the video element
                className="w-full h-auto" // Make video responsive
                controls // Add default video controls (play, pause, volume, etc.)
            >
                {/* Fallback for browsers that don't support video tag or HLS */}
                Your browser does not support the video tag or HLS playback.
            </video>
        </div>
    );
};

export default HlsVideoPlayer;