import { AdvancedScoringSystem } from './scoring_advanced.js';

// DOM Elements
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const accuracyVal = document.getElementById('acc-val');
const accRing = document.getElementById('acc-ring');
const accCircle = document.querySelector('.progress-ring__circle');
const feedbackEmoji = document.getElementById('feedback-emoji');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const timerDisplay = document.getElementById('timer');
const errorMessageDiv = document.getElementById('error-message');

// Session Data
const sessionId = document.getElementById('session_id').value;
const threshold = parseFloat(document.getElementById('accuracy_threshold').value);
const duration = parseInt(document.getElementById('duration').value);
const childAge = parseInt(document.getElementById('child_age').value);

// State - Use Advanced Scoring System
const scorer = new AdvancedScoringSystem(childAge, threshold);
let isRunning = false;
let frameCount = 0;
let timerInterval = null;

// Error Handling
function showError(message) {
    errorMessageDiv.innerHTML = `
        <div class="alert alert-danger alert-dismissible fade show" role="alert">
            <strong>Error!</strong> ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    setTimeout(() => {
        errorMessageDiv.innerHTML = '';
    }, 5000);
}

// Accuracy Circle Settings
if (accCircle) {
    const radius = accCircle.r.baseVal.value;
    const circumference = radius * 2 * Math.PI;
    accCircle.style.strokeDasharray = `${circumference} ${circumference}`;

    window.setProgress = function (percent) {
        const offset = circumference - (percent / 100 * circumference);
        accCircle.style.strokeDashoffset = offset;
    };
}

// Audio feedback with error handling
let perfectSound, failureSound;
try {
    perfectSound = new Howl({
        src: ['https://actions.google.com/sounds/v1/cartoon/clime_up_the_ladder.ogg'],
        volume: 0.5
    });

    failureSound = new Howl({
        src: ['https://actions.google.com/sounds/v1/cartoon/spring_boing.ogg'],
        volume: 0.2
    });
} catch (e) {
    console.warn('Audio initialization failed:', e);
}

function onResults(results) {
    if (!isRunning) return;

    // Set canvas size to match video
    if (canvasElement.width !== videoElement.videoWidth) {
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        for (const landmarks of results.multiHandLandmarks) {
            // Draw hand landmarks
            if (typeof drawConnectors !== 'undefined') {
                drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#3b82f6', lineWidth: 4 });
                drawLandmarks(canvasCtx, landmarks, { color: '#10b981', lineWidth: 1, radius: 2 });
            }

            const accuracyResult = scorer.calculateAccuracy(landmarks);
            const accuracy = accuracyResult.smoothed; // Use smoothed accuracy
            frameCount++;
            updateUI(accuracy);

            // Send data to backend every 60 frames (1 second at 60fps)
            if (frameCount % 60 === 0) {
                updateBackend(accuracy, landmarks, frameCount);
            }
        }
    }
    canvasCtx.restore();
}

function updateUI(accuracy) {
    if (accuracyVal) {
        accuracyVal.innerText = `${Math.round(accuracy)}%`;
    }

    if (typeof setProgress === 'function') {
        setProgress(accuracy);
    }

    // Use dynamic threshold from advanced scoring
    const dynamicThreshold = scorer.dynamicThreshold;

    if (accuracy >= dynamicThreshold) {
        accRing.className = "accuracy-ring-container glow-success";
        accCircle.style.stroke = "#10b981";

        if (accuracy > 90 && frameCount % 120 === 0) {
            showEmoji('🌟');
            if (perfectSound) perfectSound.play();
        }
    } else {
        accRing.className = "accuracy-ring-container glow-danger";
        accCircle.style.stroke = "#ef4444";

        if (frameCount % 180 === 0) {
            showEmoji('☝️');
            if (failureSound) failureSound.play();
        }
    }
}

function showEmoji(emoji) {
    if (feedbackEmoji) {
        feedbackEmoji.innerText = emoji;
        feedbackEmoji.classList.add('show');
        setTimeout(() => feedbackEmoji.classList.remove('show'), 1000);
    }
}

async function updateBackend(accuracy, landmarks, frameNum) {
    try {
        const response = await fetch('/api/session/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sessionId,
                accuracy: accuracy,
                landmarks: landmarks,
                frame_number: frameNum
            })
        });

        if (!response.ok) {
            console.error('Backend update failed with status:', response.status);
        }
    } catch (e) {
        console.error("Backend update failed:", e);
    }
}

// Initialize MediaPipe Hands
let hands, camera;

try {
    hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1, // Reset to 1 to match working student_training configuration
        minDetectionConfidence: 0.5, // Lowered from 0.7 for faster detection
        minTrackingConfidence: 0.5 // Lowered from 0.7 to maintain tracking easier
    });

    hands.onResults(onResults);

    camera = new Camera(videoElement, {
        onFrame: async () => {
            // Ensure video stream is fully loaded and ready before processing frames
            if (isRunning && hands && videoElement.readyState >= 2) {
                await hands.send({ image: videoElement });
            }
        },
        width: 640,
        height: 480
    });

    // Start camera
    camera.start().catch(err => {
        console.error('Camera start failed:', err);
        showError('Unable to access webcam. Please grant camera permissions and refresh the page.');
        startBtn.disabled = true;
    });

} catch (e) {
    console.error('MediaPipe initialization failed:', e);
    showError('Failed to initialize hand tracking. Please refresh the page.');
    startBtn.disabled = true;
}

// Start button handler
if (startBtn) {
    startBtn.onclick = () => {
        isRunning = true;
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';

        let timeLeft = duration;
        timerInterval = setInterval(() => {
            if (!isRunning) {
                clearInterval(timerInterval);
                return;
            }
            timeLeft--;
            const mins = Math.floor(timeLeft / 60);
            const secs = timeLeft % 60;
            timerDisplay.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

            if (timeLeft <= 0) {
                clearInterval(timerInterval);
                finishSession();
            }
        }, 1000);
    };
}

// Stop button handler
if (stopBtn) {
    stopBtn.onclick = finishSession;
}

async function finishSession() {
    isRunning = false;
    if (timerInterval) {
        clearInterval(timerInterval);
    }

    // Get comprehensive session summary from advanced scorer
    const summary = scorer.getSessionSummary();
    console.log('Session Summary:', summary);

    try {
        const response = await fetch('/api/session/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sessionId,
                avg_accuracy: summary.averageAccuracy,
                total_score: summary.totalScore
            })
        });

        const result = await response.json();

        // Show analysis if available
        if (result.analysis) {
            console.log('Advanced Analysis:', result.analysis);
            showSessionResults(summary, result.analysis);
        }

        // Redirect after delay
        if (result.redirect) {
            setTimeout(() => {
                window.location.href = result.redirect;
            }, 3000);
        }
    } catch (e) {
        console.error('Session completion failed:', e);
        showError('Failed to save session. Please try again.');
    }
}

function showSessionResults(summary, analysis) {
    // Update modal with results
    const gradeDisplay = document.getElementById('grade-display');
    const totalScoreEl = document.getElementById('final-total-score');
    const accuracyEl = document.getElementById('final-accuracy');
    const consistencyEl = document.getElementById('final-consistency');
    const trendEl = document.getElementById('final-trend');

    if (gradeDisplay) {
        gradeDisplay.textContent = summary.grade;
        gradeDisplay.className = `grade-badge grade-${summary.grade} d-inline-block mb-2`;
    }

    if (totalScoreEl) totalScoreEl.textContent = summary.totalScore;
    if (accuracyEl) accuracyEl.textContent = summary.averageAccuracy.toFixed(1) + '%';
    if (consistencyEl) consistencyEl.textContent = summary.consistency.score.toFixed(1) + '%';
    if (trendEl) trendEl.textContent = summary.performance.trend;

    // Show pattern alert if detected
    if (summary.patterns && summary.patterns.detected) {
        const patternAlert = document.getElementById('pattern-alert-modal');
        const patternMessage = document.getElementById('pattern-message');
        if (patternAlert) {
            patternAlert.classList.remove('d-none');
            if (patternMessage) {
                patternMessage.textContent = `Detected ${summary.patterns.count} problematic hand positions. Focus on improving these specific movements.`;
            }
        }
    }

    // Display recommendations
    if (analysis && analysis.recommendations) {
        const recList = document.getElementById('recommendations-list');
        if (recList && analysis.recommendations.length > 0) {
            recList.innerHTML = analysis.recommendations.slice(0, 3).map(rec => `
                <div class="alert alert-${rec.priority === 'High' ? 'danger' : rec.priority === 'Medium' ? 'warning' : 'info'} mb-2">
                    <strong>${rec.category}:</strong> ${rec.message}
                    <br><small class="text-muted">Action: ${rec.action}</small>
                </div>
            `).join('');
        } else if (recList) {
            recList.innerHTML = '<p class="text-success small">Great job! Keep up the excellent work! 🌟</p>';
        }
    }

    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('resultsModal'));
    modal.show();

    // Countdown redirect
    let countdown = 5;
    const countdownEl = document.getElementById('redirect-countdown');
    const countdownInterval = setInterval(() => {
        countdown--;
        if (countdownEl) countdownEl.textContent = countdown;
        if (countdown <= 0) {
            clearInterval(countdownInterval);
        }
    }, 1000);
}

// Initialize Split.js for resizable panels
if (typeof Split !== 'undefined') {
    try {
        Split(['#left-view', '#right-view'], {
            sizes: [50, 50],
            minSize: 200,
            gutterSize: 10,
            snapOffset: 0
        });
    } catch (e) {
        console.warn('Split.js initialization failed:', e);
    }
}
