import React from 'react';
import type { VideoInfo } from '../../types';

interface Props { videoInfo: VideoInfo; }

export default function VideoInfoCard({ videoInfo }: Props) {
  return (
    <div className="card">
      <div className="video-info">
        <span className={`status-dot ${videoInfo.videoId ? 'active' : 'inactive'}`} />
        <div className="text">
          {videoInfo.videoId ? (
            <>
              <div className="title">{videoInfo.videoTitle || 'YouTube Video'}</div>
              <div className="url">{videoInfo.videoUrl?.slice(0, 60)}...</div>
            </>
          ) : (
            <>
              <div className="title">No video detected</div>
              <div className="url">Open a YouTube video to translate</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
