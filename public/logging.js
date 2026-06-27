// ============================================
// LOGGING UTILITIES FOR PREPWISE
// ============================================

const Logger = {
  // Replace with your Google Apps Script deployment URL from step 6 above
  GOOGLE_SHEET_URL: 'https://script.google.com/macros/s/AKfycbwDMGcCamCSCD6ty9TdrO35QgbAPcgM-4fawuHZ0cf5FztNRDWcy_LsH-AMztJNq_Bc/exec',

  // Mouse tracking
  mouseLog: [],
  mouseTrackingInterval: null,

  // ---- EVENT LOGGING ----

  /**
   * Log a CV submission event
   */
  logCVSubmission(userData, cvExtracted = {}) {
    const event = {
      timestamp: new Date().toISOString(),
      eventType: 'CV_SUBMISSION',
      userProfile: {
        name: userData.name || '',
        email: userData.email || '',
        field: userData.field || '',
        skills: userData.skills || '',
        experience: userData.experience || '',
      },
      cvExtracted: cvExtracted,
    };

    this.sendEventToSheet(event);
    console.log('📝 CV submitted:', event);
  },

  /**
   * Log interview start event
   */
  logInterviewStart(userData, interviewMode, jobDescription = '') {
    const event = {
      timestamp: new Date().toISOString(),
      eventType: 'INTERVIEW_START',
      userName: userData.name || '',
      userField: userData.field || '',
      interviewMode: interviewMode,
      jobDescription: jobDescription.substring(0, 200), // first 200 chars
    };

    this.sendEventToSheet(event);
    console.log('🎙️ Interview started:', event);
  },

  /**
   * Log question asked event
   */
  logQuestion(questionIndex, questionText, interviewMode) {
    const event = {
      timestamp: new Date().toISOString(),
      eventType: 'QUESTION_ASKED',
      questionIndex: questionIndex,
      questionText: questionText.substring(0, 200),
      interviewMode: interviewMode,
    };

    this.sendEventToSheet(event);
  },

  /**
   * Log answer submitted event
   */
  logAnswer(questionIndex, answerText, duration) {
    const event = {
      timestamp: new Date().toISOString(),
      eventType: 'ANSWER_SUBMITTED',
      questionIndex: questionIndex,
      answerLength: answerText.length,
      durationSeconds: duration,
      answerPreview: answerText.substring(0, 100),
    };

    this.sendEventToSheet(event);
  },

  /**
   * Log interview completion with feedback
   */
  logInterviewComplete(summary, feedback, totalDuration) {
    const event = {
      timestamp: new Date().toISOString(),
      eventType: 'INTERVIEW_COMPLETE',
      durationSeconds: totalDuration,
      feedbackSummary: feedback ? feedback.substring(0, 300) : '',
      overallScore: summary ? summary.score : 0,
    };

    this.sendEventToSheet(event);

    // Also sync mouse logs when interview ends
    this.syncMouseLogs();
    console.log('✅ Interview completed');
  },

  /**
   * Send event to Google Sheets via Apps Script
   */
  sendEventToSheet(event) {
    console.log(`📤 Sending tracking event: ${event.eventType}`, event);
    
    if (!this.GOOGLE_SHEET_URL.includes('{')) {
      // Send to Apps Script using no-cors for maximum compatibility
      fetch(this.GOOGLE_SHEET_URL, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify(event),
      })
      .then(() => console.log(`✅ ${event.eventType} sent successfully (opaque response)`))
      .catch(err => console.log('❌ Tracking error:', err.message));
    }
  },

  // ---- MOUSE TRACKING ----

  /**
   * Start tracking mouse position every 500ms
   */
  startMouseTracking() {
    if (this.mouseTrackingInterval) return; // already tracking

    this.mouseLog = [];
    let lastX = 0, lastY = 0;

    document.addEventListener('mousemove', (e) => {
      lastX = e.clientX;
      lastY = e.clientY;
    });

    this.mouseTrackingInterval = setInterval(() => {
      const record = {
        timestamp: new Date().toISOString(),
        x: lastX,
        y: lastY,
      };
      this.mouseLog.push(record);

      // Keep only last 1000 records in memory (saves ~50KB)
      if (this.mouseLog.length > 1000) {
        this.mouseLog.shift();
      }
    }, 500);

    console.log('🖱️ Mouse tracking started');
  },

  /**
   * Stop tracking mouse
   */
  stopMouseTracking() {
    if (this.mouseTrackingInterval) {
      clearInterval(this.mouseTrackingInterval);
      this.mouseTrackingInterval = null;
      console.log('🖱️ Mouse tracking stopped');
    }
  },

  /**
   * Save mouse logs to localStorage
   */
  saveMouseLogs() {
    try {
      const stored = localStorage.getItem('prepwise_mouse_logs') || '[]';
      const existing = JSON.parse(stored);
      const combined = [...existing, ...this.mouseLog];
      localStorage.setItem('prepwise_mouse_logs', JSON.stringify(combined));
      console.log(`💾 Saved ${this.mouseLog.length} mouse records to localStorage`);
    } catch (e) {
      console.log('Storage error (non-critical):', e.message);
    }
  },

  /**
   * Sync mouse logs to Google Sheets
   */
  syncMouseLogs() {
    try {
      const stored = localStorage.getItem('prepwise_mouse_logs') || '[]';
      const logs = JSON.parse(stored);

      if (logs.length === 0) return;

      // Send in batches of 100 to avoid hitting request size limits
      for (let i = 0; i < logs.length; i += 100) {
        const batch = logs.slice(i, i + 100);
        const event = {
          timestamp: new Date().toISOString(),
          eventType: 'MOUSE_LOGS',
          records: batch,
          recordCount: batch.length,
        };

        this.sendEventToSheet(event);
      }

      // Clear after syncing
      localStorage.removeItem('prepwise_mouse_logs');
      console.log(`📤 Synced ${logs.length} mouse logs to sheet`);
    } catch (e) {
      console.log('Sync error (non-critical):', e.message);
    }
  },

  /**
   * Export mouse logs as JSON (for manual download)
   */
  exportMouseLogs() {
    try {
      const stored = localStorage.getItem('prepwise_mouse_logs') || '[]';
      const logs = JSON.parse(stored);
      const json = JSON.stringify(logs, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mouse-logs-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      console.log('📥 Mouse logs exported');
    } catch (e) {
      console.log('Export error:', e.message);
    }
  },

  /**
   * Get stats on stored mouse logs
   */
  getMouseLogStats() {
    try {
      const stored = localStorage.getItem('prepwise_mouse_logs') || '[]';
      const logs = JSON.parse(stored);
      return {
        totalRecords: logs.length,
        storageSizeKB: (new Blob([stored]).size / 1024).toFixed(2),
        dateRange: logs.length > 0 ? `${logs[0].timestamp} to ${logs[logs.length - 1].timestamp}` : 'empty',
      };
    } catch (e) {
      return { error: e.message };
    }
  },
};

// Auto-save mouse logs before page unload
window.addEventListener('beforeunload', () => {
  Logger.saveMouseLogs();
});
