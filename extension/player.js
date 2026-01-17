/**
 * Beef Video Player - Extension Page Script
 * Reads video URL and metadata from query params and plays the video
 */

const params = new URLSearchParams(window.location.search);
const videoUrl = params.get('video');
const title = params.get('title') || 'Beef Video';
const storyline = params.get('storyline') || '';

// Set title
document.getElementById('title').textContent = title;

// Set storyline if provided
if (storyline) {
  document.getElementById('storyline').textContent = storyline;
}

// Set video source
const video = document.getElementById('video');
if (videoUrl) {
  video.src = videoUrl;

  // Error handling
  video.onerror = () => {
    console.error('Failed to load video:', videoUrl);
    document.body.innerHTML = `
      <div style="text-align: center; padding: 40px;">
        <h2 style="color: #e94560;">Video Failed to Load</h2>
        <p style="color: #aaa;">URL: ${videoUrl}</p>
        <p style="color: #666; margin-top: 20px;">Try opening the URL directly:</p>
        <a href="${videoUrl}" target="_blank" style="color: #4dabf7;">${videoUrl}</a>
      </div>
    `;
  };

  video.onloadeddata = () => {
    console.log('Video loaded successfully');
  };

  // Autoplay when video becomes visible (scrolled into view)
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && video.paused) {
        video.play().catch(e => console.log('Autoplay prevented:', e));
      }
    });
  }, { threshold: 0.5 }); // Play when 50% visible

  observer.observe(video);
} else {
  document.body.innerHTML = `
    <div style="text-align: center; padding: 40px;">
      <h2 style="color: #e94560;">No Video URL Provided</h2>
      <p style="color: #aaa;">Missing 'video' query parameter</p>
    </div>
  `;
}
