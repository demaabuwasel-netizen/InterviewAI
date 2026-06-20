const STAGE_HASHES = ['', '#dashboard', '#profile', '#setup', '#interview', '#completion', '#report', '#practice', '#history'];
const HASH_TO_STAGE = Object.fromEntries(STAGE_HASHES.map((h, i) => [h, i]).filter(([h]) => h));

window.app = {
    async postJSON(url, payload) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
        return data;
    },

    async requestInterviewQuestion() {
        const interview = this.state.interview;
        return this.postJSON('/api/interview-next-question', {
            student_profile: this.state.user,
            job_description: this.state.job.description,
            interview_type: this.state.interviewMode,
            interview_length: interview.length,
            interviewer_style: this.state.interviewerMood,
            previous_question: interview.previousQuestion,
            latest_student_answer: interview.latestAnswer,
            full_transcript: interview.transcript,
            main_questions_asked: interview.mainQuestionsAsked,
            follow_ups_asked: interview.followUpsAsked,
            total_questions_asked: interview.questions.length,
            current_stage: interview.currentStage,
            asked_questions: interview.askedQuestions,
            covered_job_requirements: interview.coveredJobRequirements,
            skipped_questions: interview.skippedQuestions
        });
    },

    getInterviewConfig(length = this.state.wizard.length || 'short') {
        return length === 'full'
            ? { length: 'full', label: 'Full practice', mainTarget: 14, maxQuestions: 18, maxFollowUps: 4 }
            : { length: 'short', label: 'Short interview', mainTarget: 6, maxQuestions: 7, maxFollowUps: 1 };
    },

    interviewStageLabel(stage) {
        return ({ opening: 'Opening', role_fit: 'Role fit', experience: 'Experience & CV', behavioral: 'Behavioral', technical: 'Job-specific', closing: 'Closing' })[stage] || 'Interview';
    },

    appendGeneratedQuestion(result) {
        const interview = this.state.interview;
        const question = String(result.next_question || '').trim();
        const meta = {
            stage: result.interview_stage || interview.currentStage || 'opening',
            type: result.question_type || 'role_fit',
            topic: result.topic || 'Role fit',
            reason: result.reason || 'This question checks your fit for the role.',
            jobRequirement: result.job_requirement || '',
            isFollowUp: Boolean(result.is_follow_up)
        };
        interview.questions.push(question);
        interview.questionMeta.push(meta);
        interview.transcript.push({ role: 'assistant', content: question });
        interview.askedQuestions.push(question);
        interview.currentStage = meta.stage;
        interview.currentQuestionType = meta.type;
        interview.currentTopic = meta.topic;
        interview.currentQuestionReason = meta.reason;
        interview.currentJobRequirement = meta.jobRequirement;
        if (meta.isFollowUp) interview.followUpsAsked++;
        else interview.mainQuestionsAsked++;
        if (meta.jobRequirement && !interview.coveredJobRequirements.includes(meta.jobRequirement)) {
            interview.coveredJobRequirements.push(meta.jobRequirement);
        }
        return question;
    },

    shouldCompleteInterview() {
        const interview = this.state.interview;
        const currentMeta = interview.questionMeta[interview.currentQuestionIndex];
        return interview.responses.length >= interview.maxQuestions || currentMeta?.stage === 'closing';
    },

    localFollowUpQuestion() {
        const answer = this.state.interview.latestAnswer || '';
        if (answer.includes('skipped')) {
            return `Let's try a different angle. What is one project or experience that best demonstrates your fit for this role?`;
        }
        const detail = answer.split(/(?<=[.!?])\s+/)[0].slice(0, 120);
        return `You mentioned "${detail}". What was your specific contribution, and what measurable result did it produce?`;
    },

    escapeHTML(value) {
        return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        })[character]);
    },

    // --- AI Intelligence Core (Ollama Integration) ---
    async callModelAPI(promptOrMessages, systemInstruction = "", isJson = false) {
        // Handle native message array or fallback to single string prompt
        let messagesArray = [];
        if (Array.isArray(promptOrMessages)) {
            messagesArray = promptOrMessages;
        } else {
            messagesArray = [{ role: "user", content: promptOrMessages }];
        }
        
        // Prepend System Instruction
        if (systemInstruction) {
            messagesArray.unshift({ role: "system", content: systemInstruction });
        }

        const model = this.getModelForMode();
        const url = 'http://localhost:11434/api/chat';
        
        const body = {
            model: model,
            messages: messagesArray,
            stream: false,
            options: {
                temperature: isJson ? 0.1 : 0.7,
                num_predict: 2048
            }
        };

        if (isJson) {
            body.format = 'json';
        }

        try {
            const response = await fetch(url, { 
                method: 'POST', 
                headers: { 
                    'Content-Type': 'application/json'
                }, 
                body: JSON.stringify(body) 
            });
            
            if (!response.ok) {
                throw new Error(`Ollama Error: ${response.statusText}`);
            }

            const data = await response.json();
            return data.message?.content || this.getMockAIResponse(JSON.stringify(messagesArray));
        } catch (error) {
            console.error("Ollama Connection Error, falling back to Mock AI:", error);
            return this.getMockAIResponse(JSON.stringify(messagesArray));
        }
    },

    getModelForMode() {
        const mode = this.state.interviewMode;
        switch(mode) {
            case 'technical':
            case 'case':
                return 'qwen3:14b'; // Best for reasoning and technical
            case 'friendly':
                return 'gemma3:12b'; // Best for conversational
            case 'rapid':
                return 'qwen3:8b'; // Fast for rapid fire
            case 'hr':
            default:
                return 'qwen3:14b'; // Balanced for HR
        }
    },

    getInterviewSystemPrompt() {
        const moodPrompts = {
            'professional': 'Maintain a formal, professional, and slightly reserved tone. Act like a senior recruiter at a Fortune 500 company.',
            'friendly': 'Maintain a warm, encouraging, and supportive tone. Act like a helpful mentor or a friendly peer.',
            'hard': 'Maintain a challenging, skeptical, and high-pressure tone. Ask tough follow-up questions and drill down into every detail. Act like a demanding technical lead.',
            'casual': 'Maintain a relaxed, informal, and conversational tone. Use "tech-bro" or startup-style language. Act like you are meeting for coffee.'
        };
        const moodInstruction = moodPrompts[this.state.interviewerMood] || moodPrompts['professional'];

        return `
            You are the AI Interviewer for a mock interview training platform.
            Your goal is to conduct a realistic, human-like, and highly conversational interview.

            MOOD/PERSONALITY: ${moodInstruction}

            JOB DESCRIPTION: ${this.state.job.description}
            STUDENT PROFILE: ${this.state.user.name} - ${this.state.user.field}
            INTERVIEW TYPE: ${this.state.interviewMode}

            STRICT BEHAVIOR RULES:
            1. You are engaging in a back-and-forth conversation. You are reading the full conversation history.
            2. ALWAYS base your next question directly on the student's LAST answer. 
            3. Acknowledge what they just said naturally before asking the next question (e.g., "That makes sense. When you mentioned...").
            4. Ask ONLY ONE question at a time.
            5. DO NOT REPEAT previous questions or topics. Keep the conversation moving forward or deeper.
            6. If an answer is vague, ask for a specific example. If it is detailed, probe deeper into a specific technical or behavioral point they mentioned.
            7. Do not act like a robot running down a checklist. Act like a senior hiring manager having a natural dialogue.
            8. Output ONLY your next spoken message to the student. Do not output internal thoughts, JSON, or formatting.
        `;
    },

    // --- Mock AI for Demo Mode (No API Key Required) ---
    getMockAIResponse(prompt) {
        console.log("Using Mock AI Response for prompt:", prompt.substring(0, 100) + "...");
        const p = prompt.toLowerCase();
        
        // 1. Mock Job Profile Analysis
        if (p.includes('job description') && p.includes('match')) {
            return JSON.stringify({
                "matchScore": 82,
                "strengths": ["Technical Knowledge", "Problem Solving", "Experience"],
                "gaps": ["Specific Frameworks", "System Design"],
                "topics": ["Algorithm Optimization", "Team Collaboration"],
                "difficulty": "Moderate"
            });
        }

        // 2. Mock Report (Priority)
        if (p.includes('career coach') && p.includes('transcript')) {
            return JSON.stringify({
                "score": 5.4,
                "strengths": ["Some answers stayed on topic", "A few answers showed useful detail", "There is a starting base to build on"],
                "improvements": ["Add a concrete example", "Include results or metrics", "Use clearer structure in weak answers"],
                "bestAnswer": "One answer explained the idea clearly, even if it could have gone deeper.",
                "weakestAnswer": "The weakest answer stayed too brief and needed a real example.",
                "starExample": "A stronger answer would briefly describe the situation, the action you personally took, and the outcome or metric."
            });
        }

        // 3. Mock Practice Question & Feedback
        if (p.includes('practicing') || p.includes('evaluation')) {
            return "That was a solid improvement! You addressed the core of the question much more clearly this time. One thing you did well was linking your past experience directly to the challenge. To make it even stronger, try to include a specific metric or result next time.";
        }
        if (p.includes('practice') && (p.includes('weakest area') || p.includes('weakness'))) {
            const area = this.state.currentPracticeWeakness || "Communication";
            return `I noticed that ${area} is an area you want to work on. Can you tell me about a time when you struggled with this, and what you did to overcome it?`;
        }

        // 4. Mock Report (Fallback)
        if (p.includes('report')) {
            return JSON.stringify({
                "score": 5.4,
                "strengths": ["Some answers stayed on topic", "A few answers showed useful detail", "There is a starting base to build on"],
                "improvements": ["Add a concrete example", "Include results or metrics", "Use clearer structure in weak answers"],
                "bestAnswer": "One answer explained the idea clearly, even if it could have gone deeper.",
                "weakestAnswer": "The weakest answer stayed too brief and needed a real example.",
                "starExample": "A stronger answer would briefly describe the situation, the action you personally took, and the outcome or metric."
            });
        }

        // 4. Mock Interviewer Generator
        if (p.includes('start the interview') || this.state.interview.transcript.length === 0) {
            return "Hi! It's great to meet you today. To start things off, could you tell me a bit about your background and what specifically interests you about this role?";
        }
        
        const followups = [
            "That's interesting. You mentioned working on the frontend — what was one specific feature you built that you're proud of?",
            "I see. When you said authentication was difficult, what exactly made it a challenge for you?",
            "Before we move on, I'd like to understand your role in that project more clearly. What were your main responsibilities?",
            "Got it. Can you walk me through a specific time when you had to debug a difficult problem in that system?"
        ];
        return followups[Math.floor(Math.random() * followups.length)];
    },

    state: {
        currentStage: 0,
        interviewMode: 'hr',
        interviewerMood: 'professional',
        isGuest: false,
        isEditingProfile: false,
        currentUser: null,
        wizard: { step: 1, goal: 'specific', jobDesc: '', style: 'hr', mood: 'professional', length: 'short', method: 'text' },
        user: {
            name: '', email: '', field: 'Software Engineering', targetRole: '', location: '', phone: '', summary: '',
            skills: '', courses: '', projects: '', experience: '', linkedin: '', certifications: '', languages: '', cvData: null
        },
        job: { description: '', link: '' },
        analysis: { matchScore: 0, difficulty: 'Moderate', strengths: [], gaps: [], topics: [] },
        interview: {
            length: 'short',
            mainTarget: 6,
            maxQuestions: 7,
            maxFollowUps: 1,
            mainQuestionsAsked: 0,
            followUpsAsked: 0,
            currentQuestionIndex: 0,
            questions: [],
            questionMeta: [],
            responses: [],
            skippedQuestions: [],
            clarificationRequests: [],
            coveredJobRequirements: [],
            startTime: null,
            isListening: false,
            awaitingFollowUp: false,

            // New Stateful Logic Fields
            currentPhase: 'opening',
            currentTopic: 'introduction',
            previousQuestion: '',
            latestAnswer: '',
            transcript: [],
            plan: [],
            transcriptSummary: '',
            studentFactsMentioned: [],
            openFollowUps: [],
            coveredTopics: [],
            unansweredPoints: [],
            askedQuestions: [],
            answerQuality: {
                answeredQuestion: 'unclear',
                specificity: 'okay',
                relevance: 'strong',
                confidence: 'medium'
            },
            nextAction: 'ask_follow_up'
        },
        transcriptState: { final: '', interim: '', isEditing: false },
        sessions: []
    },

    // --- Init ---
    init() {
        this.cacheDOM();
        this.bindEvents();
        this.initSpeech();
        this.checkAuth();
        this.initRouting();
        this.setupPopstateListener();
        if (typeof Logger !== 'undefined') Logger.startMouseTracking();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    cacheDOM() {
        this.views = {
            auth: document.getElementById('auth-view'),
            dashboard: document.getElementById('view-dashboard'),
            profile: document.getElementById('view-profile'),
            setup: document.getElementById('view-setup'),
            interview: document.getElementById('view-interview'),
            completion: document.getElementById('view-completion'),
            report: document.getElementById('view-report'),
            practice: document.getElementById('view-practice'),
            history: document.getElementById('view-history')
        };
        this.nav = document.getElementById('app-nav');
        this.forms = {
            auth: document.getElementById('auth-form'),
            profile: document.getElementById('profile-form'),
            job: document.getElementById('job-form')
        };
        this.populateFocusAreas();
        this.renderProfileEducation([]);
    },

    bindEvents() {
        if (this.forms.auth) {
            this.forms.auth.addEventListener('submit', (e) => { e.preventDefault(); this.handleAuth(); });
        }
        if (this.forms.profile) {
            this.forms.profile.addEventListener('submit', (e) => { e.preventDefault(); this.handleProfileSubmit(); });
        }
        if (this.forms.job) {
            this.forms.job.addEventListener('submit', (e) => { e.preventDefault(); this.handleJobSubmit(); });
        }
    },

    populateFocusAreas() {
        const areas = [
            "Software Engineering", "Artificial Intelligence", "Cybersecurity", "Cloud / DevOps", "Networking",
            "Information Systems", "Game Development", "Data Science", "Statistics", "Mathematics",
            "Physics", "Biology", "Chemistry", "Finance", "Economics", "Accounting", "Business Administration",
            "Entrepreneurship", "Consulting", "Supply Chain / Operations", "Human Resources", "Marketing",
            "Digital Marketing", "Media & Communication", "Content Creation", "Psychology", "Law", "Medicine",
            "Industrial Engineering", "Mechanical Engineering", "Electrical Engineering", "Civil Engineering",
            "Architecture", "Education", "UX Research", "Graphic Design"
        ];
        
        const selects = ['field-select', 'prof-field'].map(id => document.getElementById(id)).filter(Boolean);
        selects.forEach(select => {
            select.innerHTML = areas.map(a => `<option value="${a}">${a}</option>`).join('');
        });
    },

    // --- Modal & Theme ---
    openHowItWorks() {
        const modal = document.getElementById('how-it-works-modal');
        if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },
    closeHowItWorks() {
        const modal = document.getElementById('how-it-works-modal');
        if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
    },

    setTheme(mode) {
        const isDark = mode === 'dark';
        const indicator = document.getElementById('theme-indicator');
        const sun = document.getElementById('theme-light');
        const moon = document.getElementById('theme-dark');

        document.body.classList.toggle('dark', isDark);
        // Clear any inline style overrides so CSS class takes precedence
        document.body.style.backgroundColor = '';
        document.body.style.color = '';

        if (indicator) indicator.style.left = isDark ? 'calc(100% - 36px)' : '4px';
        if (isDark) {
            if (moon) { moon.classList.add('text-brand-500'); moon.classList.remove('text-slate-300'); }
            if (sun) { sun.classList.remove('text-brand-500'); sun.classList.add('text-slate-300'); }
        } else {
            if (sun) { sun.classList.add('text-brand-500'); sun.classList.remove('text-slate-300'); }
            if (moon) { moon.classList.remove('text-brand-500'); moon.classList.add('text-slate-300'); }
        }
    },

    toggleAuthMode() {
        const btn = document.getElementById('auth-submit-btn');
        const title = document.getElementById('auth-title');
        const subtitle = document.getElementById('auth-subtitle');
        const toggleBtn = document.getElementById('toggle-auth-mode');
        const isLogin = btn.dataset.mode !== 'signup';
        if (isLogin) {
            btn.dataset.mode = 'signup';
            if (title) title.textContent = 'Create Account 👋';
            if (subtitle) subtitle.textContent = 'Join 2,000+ students growing with us.';
            btn.innerHTML = 'Create Account <i data-lucide="arrow-right" class="w-5 h-5 ml-1 inline"></i>';
            if (toggleBtn) toggleBtn.textContent = 'Already have an account? Sign in';
        } else {
            btn.dataset.mode = 'login';
            if (title) title.textContent = 'Welcome back! 👋';
            if (subtitle) subtitle.textContent = "Let's continue your journey.";
            btn.innerHTML = 'Sign In <i data-lucide="arrow-right" class="w-5 h-5 ml-1 inline"></i>';
            if (toggleBtn) toggleBtn.textContent = 'New here? Create an account';
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    simulateSocialLogin(provider) {
        const loader = document.getElementById('app-loader');
        const loaderText = document.getElementById('loader-text');
        if (loader) {
            loader.classList.remove('hidden'); loader.classList.add('flex');
            if (loaderText) loaderText.textContent = `Syncing ${provider}...`;
            setTimeout(() => {
                loader.classList.add('hidden'); loader.classList.remove('flex');
                this.state.user.name = provider === 'Google' ? 'Google Candidate' : 'GitHub Developer';
                this.state.user.email = provider.toLowerCase() + '@simulation.edu';
                this.state.currentUser = { email: this.state.user.email, profile: this.state.user, sessions: [], isGuest: false };
                localStorage.setItem('prepwise_session_v3', JSON.stringify(this.state.currentUser));
                this.updateUserUI();
                this.showDashboard();
            }, 2000);
        }
    },

    // --- Auth ---
    checkAuth() {
        const session = localStorage.getItem('prepwise_session_v3');
        if (session) {
            try {
                const data = JSON.parse(session);
                this.state.currentUser = data;
                this.state.user = data.profile || this.state.user;
                this.state.sessions = data.sessions || [];
                this.state.isGuest = data.isGuest || false;
                this.updateUserUI();
                this.showDashboard();
            } catch(e) {
                this.goToStage(0);
            }
        } else {
            this.goToStage(0);
        }
    },

    initRouting() {
        const hash = window.location.hash;
        const stage = HASH_TO_STAGE[hash];
        if (stage && this.state.currentUser) {
            this._navigateToStage(stage);
        }
        history.replaceState({ stage: this.state.currentStage }, '', window.location.hash || '');
    },

    setupPopstateListener() {
        window.addEventListener('popstate', (e) => {
            if (e.state && typeof e.state.stage === 'number') {
                const target = e.state.stage;
                this._navigateToStage(target);
            } else {
                const hash = window.location.hash;
                const stage = HASH_TO_STAGE[hash];
                if (stage !== undefined && this.state.currentUser) {
                    this._navigateToStage(stage);
                } else {
                    this._navigateToStage(0);
                }
            }
        });
    },

    handleAuth() {
        const emailEl = document.getElementById('auth-email');
        const btn = document.getElementById('auth-submit-btn');
        if (!emailEl) return;
        const email = emailEl.value.trim();
        if (!email) return;
        const isSignUp = btn && btn.dataset.mode === 'signup';
        let users = JSON.parse(localStorage.getItem('prepwise_users_v3') || '{}');
        if (isSignUp) {
            if (users[email]) return alert("An account already exists for this email. Please sign in.");
            users[email] = { profile: null, sessions: [] };
            localStorage.setItem('prepwise_users_v3', JSON.stringify(users));
        } else {
            if (!users[email]) {
                users[email] = { profile: null, sessions: [] };
                localStorage.setItem('prepwise_users_v3', JSON.stringify(users));
            }
        }
        this.state.currentUser = { email, ...users[email], isGuest: false };
        localStorage.setItem('prepwise_session_v3', JSON.stringify(this.state.currentUser));
        if (this.state.currentUser.profile) {
            this.state.user = this.state.currentUser.profile;
            this.state.sessions = this.state.currentUser.sessions || [];
            this.updateUserUI();
            this.showDashboard();
        } else {
            this.showDashboard();
        }
    },

    handleProfileSubmit() {
        this.saveProfile();
    },

    addEducationEntry(education = {}) {
        const container = document.getElementById('prof-education-list');
        if (!container) return;
        const esc = (value) => this.escapeHTML(value || '');
        const entry = document.createElement('div');
        entry.className = 'profile-education-item border border-slate-200 rounded-xl p-4 bg-slate-50/60 space-y-4';
        entry.innerHTML = `
            <div class="flex items-center justify-between">
                <p class="education-entry-title text-sm font-bold text-slate-800">Education</p>
                <button type="button" onclick="window.app.removeEducationEntry(this)" class="text-xs font-semibold text-slate-400 hover:text-red-600 flex items-center gap-1" aria-label="Remove education">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Remove
                </button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label class="block text-xs font-semibold text-slate-600 mb-1.5">Degree or program</label><input data-key="degree" value="${esc(education.degree)}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="BSc, diploma, bootcamp..."></div>
                <div><label class="block text-xs font-semibold text-slate-600 mb-1.5">Institution</label><input data-key="institution" value="${esc(education.institution)}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="University or school"></div>
                <div><label class="block text-xs font-semibold text-slate-600 mb-1.5">Field of study</label><input data-key="field" value="${esc(education.field)}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="Computer Science, Finance..."></div>
                <div class="grid grid-cols-2 gap-2">
                    <div><label class="block text-xs font-semibold text-slate-600 mb-1.5">Start</label><input data-key="startDate" value="${esc(education.startDate)}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="2021"></div>
                    <div><label class="block text-xs font-semibold text-slate-600 mb-1.5">End</label><input data-key="endDate" value="${esc(education.endDate)}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="2025 or Present"></div>
                </div>
            </div>
            <div><label class="block text-xs font-semibold text-slate-600 mb-1.5">Details or achievements</label><textarea data-key="details" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm min-h-[65px]" placeholder="Honors, specialization, thesis, relevant achievements...">${esc(education.details)}</textarea></div>
        `;
        container.appendChild(entry);
        this.updateEducationEntryTitles();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    removeEducationEntry(button) {
        const entries = document.querySelectorAll('.profile-education-item');
        if (entries.length <= 1) {
            entries[0]?.querySelectorAll('input, textarea').forEach((field) => { field.value = ''; });
            return;
        }
        button.closest('.profile-education-item')?.remove();
        this.updateEducationEntryTitles();
    },

    updateEducationEntryTitles() {
        document.querySelectorAll('.profile-education-item .education-entry-title').forEach((title, index) => {
            title.textContent = `Education ${index + 1}`;
        });
    },

    renderProfileEducation(items) {
        const container = document.getElementById('prof-education-list');
        if (!container) return;
        container.innerHTML = '';
        const educationItems = Array.isArray(items) && items.length ? items : [{}];
        educationItems.forEach((item) => this.addEducationEntry(item));
        this.renderProfileSummary();
    },

    collectProfileEducation() {
        return Array.from(document.querySelectorAll('.profile-education-item')).map((entry) => {
            const item = { degree: '', institution: '', field: '', startDate: '', endDate: '', details: '' };
            entry.querySelectorAll('[data-key]').forEach((field) => { item[field.dataset.key] = field.value.trim(); });
            return item;
        }).filter((item) => Object.values(item).some(Boolean));
    },

    getProfileCompletionSummary() {
        const cvData = this.normalizeCVData(this.state.user.cvData || {});
        const checks = [
            { label: 'Name', present: Boolean(this.state.user.name) },
            { label: 'Target role', present: Boolean(this.state.user.targetRole || cvData.targetRole) },
            { label: 'Skills', present: Boolean(this.state.user.skills || Object.values(cvData.skills || {}).some((items) => items.length)) },
            { label: 'Education', present: Boolean(this.collectProfileEducation().length || cvData.education.length || this.state.user.courses) },
            { label: 'Projects or experience', present: Boolean(this.state.user.projects || this.state.user.experience || cvData.experience.length || cvData.projects.length) }
        ];
        const total = checks.length;
        const complete = checks.filter((item) => item.present).length;
        const pct = Math.round((complete / total) * 100);
        const missing = checks.filter((item) => !item.present).map((item) => item.label);
        return {
            pct,
            missing,
            note: pct >= 80
                ? 'Your profile is strong enough for specific interview questions.'
                : pct >= 60
                    ? 'You have a solid base. Add a bit more detail to improve the next interview.'
                    : 'Add a few core details so the AI can ask more relevant questions.'
        };
    },

    renderProfileSummary() {
        const summary = this.getProfileCompletionSummary();
        const headerName = document.getElementById('prof-header-name');
        const headerRole = document.getElementById('prof-header-role');
        const pctEl = document.getElementById('prof-strength-pct');
        const barEl = document.getElementById('prof-strength-bar');
        const noteEl = document.getElementById('prof-strength-note');
        const missingEl = document.getElementById('prof-missing');
        if (headerName) headerName.textContent = this.state.user.name || 'Your profile';
        if (headerRole) headerRole.textContent = this.state.user.targetRole || this.state.user.field || 'Target role / field';
        if (pctEl) pctEl.textContent = `${summary.pct}%`;
        if (barEl) barEl.style.width = `${summary.pct}%`;
        if (noteEl) noteEl.textContent = summary.note;
        if (missingEl) {
            missingEl.innerHTML = summary.missing.length
                ? `<span class="text-xs text-slate-400 mr-1">Helpful to add:</span>${summary.missing.map((item) => `<span class="profile-missing-item">${this.escapeHTML(item)}</span>`).join('')}`
                : '<span class="text-xs font-semibold text-emerald-600">Profile looks complete.</span>';
        }
    },

    focusProfileField(id) {
        const field = document.getElementById(id);
        if (!field) return;
        field.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => field.focus(), 250);
    },

    saveProfile(continueToSetup = false) {
        const nameEl = document.getElementById('prof-name');
        const fieldEl = document.getElementById('prof-field');
        const skillsEl = document.getElementById('prof-skills');
        const coursesEl = document.getElementById('prof-courses');
        const projectsEl = document.getElementById('prof-projects');
        const experienceEl = document.getElementById('prof-experience');
        const linkedinEl = document.getElementById('prof-linkedin');
        const targetRoleEl = document.getElementById('prof-target-role');
        const locationEl = document.getElementById('prof-location');
        const phoneEl = document.getElementById('prof-phone');
        const summaryEl = document.getElementById('prof-summary');
        const certificationsEl = document.getElementById('prof-certifications');
        const languagesEl = document.getElementById('prof-languages');
        
        this.state.user.name = nameEl ? nameEl.value.trim() : '';
        this.state.user.field = fieldEl ? fieldEl.value.trim() : 'Software Engineering';
        this.state.user.skills = skillsEl ? skillsEl.value.trim() : '';
        this.state.user.courses = coursesEl ? coursesEl.value.trim() : '';
        this.state.user.projects = projectsEl ? projectsEl.value.trim() : '';
        this.state.user.experience = experienceEl ? experienceEl.value.trim() : '';
        this.state.user.linkedin = linkedinEl ? linkedinEl.value.trim() : '';
        this.state.user.targetRole = targetRoleEl ? targetRoleEl.value.trim() : '';
        this.state.user.location = locationEl ? locationEl.value.trim() : '';
        this.state.user.phone = phoneEl ? phoneEl.value.trim() : '';
        this.state.user.summary = summaryEl ? summaryEl.value.trim() : '';
        this.state.user.certifications = certificationsEl ? certificationsEl.value.trim() : '';
        this.state.user.languages = languagesEl ? languagesEl.value.trim() : '';

        const cvData = this.normalizeCVData(this.state.user.cvData || {});
        cvData.targetRole = this.state.user.targetRole;
        cvData.location = this.state.user.location;
        cvData.phone = this.state.user.phone;
        cvData.summary = this.state.user.summary;
        cvData.education = this.collectProfileEducation();
        cvData.relevantCourses = this.splitCVList(this.state.user.courses);
        const structuredSkillNames = new Set(Object.values(cvData.skills).flat().map((skill) => skill.toLowerCase()));
        const additionalSkills = this.splitCVList(this.state.user.skills).filter((skill) => !structuredSkillNames.has(skill.toLowerCase()));
        cvData.skills.other = [...cvData.skills.other, ...additionalSkills];
        cvData.certifications = this.splitCVList(this.state.user.certifications);
        cvData.languages = this.splitCVList(this.state.user.languages);
        this.state.user.cvData = cvData;
        
        this.saveUserData();
        this.updateUserUI();
        if (continueToSetup) this.goToStage(3);
        else this.showDashboard();
    },

    openEditProfile() {
        const nameEl = document.getElementById('prof-name');
        const fieldEl = document.getElementById('prof-field');
        const skillsEl = document.getElementById('prof-skills');
        const coursesEl = document.getElementById('prof-courses');
        const projectsEl = document.getElementById('prof-projects');
        const experienceEl = document.getElementById('prof-experience');
        const linkedinEl = document.getElementById('prof-linkedin');
        const cvData = this.normalizeCVData(this.state.user.cvData || {});
        const extraFields = {
            'prof-target-role': this.state.user.targetRole || cvData.targetRole,
            'prof-location': this.state.user.location || cvData.location,
            'prof-phone': this.state.user.phone || cvData.phone,
            'prof-summary': this.state.user.summary || cvData.summary,
            'prof-certifications': this.state.user.certifications || cvData.certifications.join('\n'),
            'prof-languages': this.state.user.languages || cvData.languages.join('\n')
        };

        if (nameEl) nameEl.value = this.state.user.name || '';
        if (fieldEl) fieldEl.value = this.state.user.field || '';
        if (skillsEl) skillsEl.value = this.state.user.skills || '';
        if (coursesEl) coursesEl.value = this.state.user.courses || '';
        if (projectsEl) projectsEl.value = this.state.user.projects || cvData.projects.map((item) => [item.name, item.role, item.description, item.technologies?.join(', '), item.impact].filter(Boolean).join(' — ')).join('\n');
        if (experienceEl) experienceEl.value = this.state.user.experience || '';
        if (linkedinEl) linkedinEl.value = this.state.user.linkedin || '';
        Object.entries(extraFields).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.value = value || '';
        });
        this.renderProfileEducation(cvData.education);
        this.renderProfileSummary();
        
        this.goToStage(2);
    },

    updateOnboardingUI() {
    },

    toggleCVImport() {
        const body = document.getElementById('cv-import-body');
        const chevron = document.getElementById('cv-chevron');
        if (!body) return;
        const isOpen = !body.classList.contains('hidden');
        body.classList.toggle('hidden', isOpen);
        if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
    },

    switchCVTab(tab) {
        const isUpload = tab === 'upload';
        const uploadPanel = document.getElementById('cv-upload-panel');
        const pastePanel = document.getElementById('cv-paste-panel');
        const tabUpload = document.getElementById('cv-tab-upload');
        const tabPaste = document.getElementById('cv-tab-paste');
        
        if (uploadPanel) uploadPanel.classList.toggle('hidden', !isUpload);
        if (pastePanel) pastePanel.classList.toggle('hidden', isUpload);
        
        if (tabUpload) {
            tabUpload.classList.toggle('border-brand-500', isUpload);
            tabUpload.classList.toggle('text-brand-600', isUpload);
            tabUpload.classList.toggle('border-transparent', !isUpload);
            tabUpload.classList.toggle('text-slate-400', !isUpload);
        }
        if (tabPaste) {
            tabPaste.classList.toggle('border-brand-500', !isUpload);
            tabPaste.classList.toggle('text-brand-600', !isUpload);
            tabPaste.classList.toggle('border-transparent', isUpload);
            tabPaste.classList.toggle('text-slate-400', isUpload);
        }
    },

    isDevelopmentMode() {
        return ['localhost', '127.0.0.1', ''].includes(window.location.hostname);
    },

    debugCV(label, value) {
        if (this.isDevelopmentMode()) console.debug(`[CV] ${label}`, value);
    },

    setCVStatus(message, isError = false) {
        const status = document.getElementById('cv-import-status');
        if (!status) return;
        status.textContent = message;
        status.classList.remove('hidden', 'text-green-600', 'text-red-600', 'text-slate-600');
        status.classList.add(isError ? 'text-red-600' : 'text-slate-600');
        document.getElementById('cv-fallback-actions')?.classList.toggle('hidden', !isError);
    },

    cleanCVText(rawText, pages = []) {
        const sectionPattern = /^(education|experience|work experience|employment|projects?|skills?|certifications?|languages?|coursework|relevant courses|summary|profile|השכלה|ניסיון|פרויקטים|כישורים|مهارات|التعليم|الخبرة|المشاريع)$/iu;
        const repeatedMargins = new Set();
        if (pages.length > 1) {
            const counts = new Map();
            pages.forEach((page) => {
                const lines = page.split('\n').map((line) => line.trim()).filter(Boolean);
                [...lines.slice(0, 2), ...lines.slice(-2)].forEach((line) => {
                    const key = line.replace(/\s+/g, ' ').toLowerCase();
                    if (key.length > 2 && key.length < 100) counts.set(key, (counts.get(key) || 0) + 1);
                });
            });
            counts.forEach((count, line) => {
                if (count > 1 && !sectionPattern.test(line)) repeatedMargins.add(line);
            });
        }

        const seenRepeatedMargins = new Set();
        const cleanedLines = String(rawText || '')
            .normalize('NFKC')
            .replace(/\r/g, '\n')
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
            .replace(/[•●▪◦‣]/g, '- ')
            .split('\n')
            .map((line) => line.replace(/[ \t]+/g, ' ').trim())
            .filter((line) => line && !/^(?:page\s*)?\d+(?:\s*(?:of|\/|מתוך|من)\s*\d+)?$/iu.test(line))
            .filter((line) => {
                const key = line.toLowerCase();
                if (!repeatedMargins.has(key)) return true;
                if (seenRepeatedMargins.has(key)) return false;
                seenRepeatedMargins.add(key);
                return true;
            });

        return cleanedLines
            .filter((line, index) => index === 0 || line !== cleanedLines[index - 1])
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    },

    async handleCVUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const nameEl = document.getElementById('cv-file-name');
        const parseBtn = document.getElementById('btn-parse-pdf');
        
        if (nameEl) {
            nameEl.textContent = file.name;
            nameEl.classList.remove('hidden');
        }
        if (file.size > 5 * 1024 * 1024) {
            this.setCVStatus('Please choose a PDF smaller than 5MB.', true);
            if (parseBtn) parseBtn.disabled = true;
            return;
        }
        if (parseBtn) parseBtn.disabled = true;
        this.setCVStatus('Reading PDF locally...');

        const reader = new FileReader();
        reader.onload = async (e) => {
            const typedarray = new Uint8Array(e.target.result);
            try {
                const pdf = await pdfjsLib.getDocument(typedarray).promise;
                const pages = [];
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map((item) => `${item.str}${item.hasEOL ? '\n' : ' '}`).join('');
                    pages.push(pageText);
                }
                const rawText = pages.join('\n\n');
                this._pendingCVPages = pages;
                this._pendingCVText = this.cleanCVText(rawText, pages);
                this.debugCV('raw extracted PDF text length', rawText.length);
                this.debugCV('cleaned text preview', this._pendingCVText.slice(0, 600));
                if (this._pendingCVText.length < 40) throw new Error('The PDF contains too little selectable text.');
                if (parseBtn) parseBtn.disabled = false;
                this.setCVStatus('PDF ready. Click “Parse PDF” to review the extracted information.');
            } catch (err) {
                console.error("Error parsing PDF:", err);
                this._pendingCVText = '';
                if (parseBtn) parseBtn.disabled = true;
                this.setCVStatus('We could not read this PDF. Paste the CV text below or fill the profile manually.', true);
            }
        };
        reader.readAsArrayBuffer(file);
    },

    normalizeCVData(value) {
        const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        const string = (item, max = 4000) => typeof item === 'string' ? item.trim().slice(0, max) : '';
        const list = (items, max = 50) => Array.isArray(items)
            ? items.slice(0, max).map((item) => string(item, 500)).filter(Boolean)
            : [];
        const objects = (items, keys, arrayKeys = []) => Array.isArray(items)
            ? items.slice(0, 20).filter((item) => item && typeof item === 'object' && !Array.isArray(item)).map((item) => {
                const normalized = {};
                keys.forEach((key) => { normalized[key] = arrayKeys.includes(key) ? list(item[key], 30) : string(item[key]); });
                return normalized;
            })
            : [];
        const confidence = source.confidence && typeof source.confidence === 'object' ? source.confidence : {};
        const confidenceValue = (key) => ['high', 'medium', 'low'].includes(confidence[key]) ? confidence[key] : 'low';
        const skills = source.skills && typeof source.skills === 'object' && !Array.isArray(source.skills) ? source.skills : {};

        return {
            name: string(source.name, 200), email: string(source.email, 320), phone: string(source.phone, 100),
            location: string(source.location, 300), targetRole: string(source.targetRole, 300), summary: string(source.summary),
            education: objects(source.education, ['degree', 'institution', 'field', 'startDate', 'endDate', 'details']),
            relevantCourses: list(source.relevantCourses),
            skills: {
                programmingLanguages: list(skills.programmingLanguages), frameworks: list(skills.frameworks),
                tools: list(skills.tools), databases: list(skills.databases), softSkills: list(skills.softSkills), other: list(skills.other)
            },
            experience: objects(source.experience, ['title', 'organization', 'startDate', 'endDate', 'description', 'skillsUsed'], ['skillsUsed']),
            projects: objects(source.projects, ['name', 'description', 'technologies', 'role', 'impact'], ['technologies']),
            certifications: list(source.certifications), languages: list(source.languages), missingFields: list(source.missingFields),
            confidence: {
                name: confidenceValue('name'), education: confidenceValue('education'), skills: confidenceValue('skills'),
                experience: confidenceValue('experience'), projects: confidenceValue('projects')
            }
        };
    },

    async autofillFromCV() {
        const pastePanel = document.getElementById('cv-paste-panel');
        const pastedText = document.getElementById('cv-text-input')?.value || '';
        const sourceText = pastePanel && !pastePanel.classList.contains('hidden') && pastedText.trim()
            ? pastedText
            : this._pendingCVText || pastedText;
        const cleanedText = this.cleanCVText(sourceText, sourceText === this._pendingCVText ? this._pendingCVPages || [] : []);
        if (cleanedText.length < 40) {
            this.setCVStatus('Please upload a readable PDF or paste more CV text before parsing.', true);
            return;
        }

        this.debugCV('cleaned text preview', cleanedText.slice(0, 600));
        this.setCVStatus('Analyzing your CV...');
        try {
            const result = await this.postJSON('/api/parse-cv', { cv_text: cleanedText });
            const parsed = this.normalizeCVData(result);
            this._cvRawParsed = parsed;
            this.debugCV('parsed JSON result', parsed);
            this.showCVReviewModal(parsed);
            this.setCVStatus('CV parsed. Review the information before saving.');
        } catch (error) {
            console.error('CV parsing failed:', error);
            const input = document.getElementById('cv-text-input');
            if (input && !input.value.trim()) input.value = cleanedText;
            this.switchCVTab('paste');
            this.setCVStatus('We could not analyze this CV. You can retry with pasted text or fill the profile manually.', true);
        }
    },

    showCVReviewModal(parsed) {
        this.closeCVReviewModal();
        const esc = (value) => this.escapeHTML(value);
        const input = (id, label, value, placeholder = '') => `<div><label class="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">${label}</label><input id="${id}" value="${esc(value)}" placeholder="${esc(placeholder)}" class="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:border-brand-500 focus:outline-none"></div>`;
        const textarea = (id, label, value, placeholder = '') => `<div><label class="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">${label}</label><textarea id="${id}" placeholder="${esc(placeholder)}" class="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:border-brand-500 focus:outline-none min-h-[80px]">${esc(value)}</textarea></div>`;
        const rowInput = (key, label, value) => `<div><label class="block text-[9px] font-bold text-slate-400 uppercase mb-1">${label}</label><input data-key="${key}" value="${esc(value)}" class="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"></div>`;
        const listRows = (type, items, renderer) => items.length
            ? items.map((item, index) => `<div class="cv-${type}-item p-4 border border-slate-200 rounded-xl space-y-3"><p class="text-xs font-black text-brand-600 uppercase">${type} ${index + 1}</p>${renderer(item)}</div>`).join('')
            : `<p class="text-xs text-slate-400">None found. Choose “Edit manually” to add this information directly to your profile.</p>`;
        const educationRows = listRows('education', parsed.education, (item) => `<div class="grid md:grid-cols-2 gap-3">${rowInput('degree', 'Degree', item.degree)}${rowInput('institution', 'Institution', item.institution)}${rowInput('field', 'Field', item.field)}${rowInput('startDate', 'Start date', item.startDate)}${rowInput('endDate', 'End date', item.endDate)}</div>${textarea('', 'Details', item.details).replace('id=""', 'data-key="details"')}`);
        const experienceRows = listRows('experience', parsed.experience, (item) => `<div class="grid md:grid-cols-2 gap-3">${rowInput('title', 'Title', item.title)}${rowInput('organization', 'Organization', item.organization)}${rowInput('startDate', 'Start date', item.startDate)}${rowInput('endDate', 'End date', item.endDate)}</div>${textarea('', 'Description', item.description).replace('id=""', 'data-key="description"')}${textarea('', 'Skills used (comma separated)', item.skillsUsed.join(', ')).replace('id=""', 'data-key="skillsUsed"')}`);
        const projectRows = listRows('project', parsed.projects, (item) => `${input('', 'Project name', item.name).replace('id=""', 'data-key="name"')}${textarea('', 'Description', item.description).replace('id=""', 'data-key="description"')}${textarea('', 'Technologies (comma separated)', item.technologies.join(', ')).replace('id=""', 'data-key="technologies"')}${input('', 'Your role', item.role).replace('id=""', 'data-key="role"')}${input('', 'Impact', item.impact).replace('id=""', 'data-key="impact"')}`);
        const missing = parsed.missingFields.length ? parsed.missingFields.map((field) => `<span class="px-2 py-1 rounded-full bg-amber-100 text-amber-800 text-xs">${esc(field)}</span>`).join('') : '<span class="text-xs text-green-700">No important missing fields detected.</span>';

        const modal = document.createElement('div');
        modal.id = 'cv-review-modal';
        modal.className = 'fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
                <div class="sticky top-0 bg-gradient-to-r from-brand-500 to-brand-600 p-6 text-white">
                    <h2 class="text-2xl font-black">We found this information from your CV</h2>
                    <p class="text-sm opacity-90 mt-1">Review and edit it before anything is saved to your profile.</p>
                </div>
                <div class="p-6 space-y-5">
                    <div class="p-4 bg-amber-50 border border-amber-100 rounded-xl"><p class="text-xs font-black text-amber-900 uppercase mb-2">Missing fields</p><div class="flex flex-wrap gap-2">${missing}</div></div>
                    <div class="grid md:grid-cols-2 gap-4">${input('cv-review-name', `Full name · ${parsed.confidence.name} confidence`, parsed.name)}${input('cv-review-email', 'Email', parsed.email)}${input('cv-review-phone', 'Phone', parsed.phone)}${input('cv-review-location', 'Location', parsed.location)}${input('cv-review-role', 'Target role', parsed.targetRole)}</div>
                    ${textarea('cv-review-summary', 'Summary', parsed.summary)}
                    <section class="space-y-3"><h3 class="font-black text-brand-900">Education · ${esc(parsed.confidence.education)} confidence</h3>${educationRows}</section>
                    ${textarea('cv-review-courses', 'Relevant courses (comma separated)', parsed.relevantCourses.join(', '))}
                    <section class="space-y-3"><h3 class="font-black text-brand-900">Skills · ${esc(parsed.confidence.skills)} confidence</h3><div class="grid md:grid-cols-2 gap-4">${textarea('cv-skills-programmingLanguages', 'Programming languages', parsed.skills.programmingLanguages.join(', '))}${textarea('cv-skills-frameworks', 'Frameworks', parsed.skills.frameworks.join(', '))}${textarea('cv-skills-tools', 'Tools', parsed.skills.tools.join(', '))}${textarea('cv-skills-databases', 'Databases', parsed.skills.databases.join(', '))}${textarea('cv-skills-softSkills', 'Soft skills', parsed.skills.softSkills.join(', '))}${textarea('cv-skills-other', 'Other', parsed.skills.other.join(', '))}</div></section>
                    <section class="space-y-3"><h3 class="font-black text-brand-900">Experience · ${esc(parsed.confidence.experience)} confidence</h3>${experienceRows}</section>
                    <section class="space-y-3"><h3 class="font-black text-brand-900">Projects · ${esc(parsed.confidence.projects)} confidence</h3>${projectRows}</section>
                    <div class="grid md:grid-cols-2 gap-4">${textarea('cv-review-certifications', 'Certifications (one per line)', parsed.certifications.join('\n'))}${textarea('cv-review-languages', 'Languages (one per line)', parsed.languages.join('\n'))}</div>
                </div>
                <div class="sticky bottom-0 bg-slate-50 border-t border-slate-200 p-6 flex gap-3">
                    <button onclick="window.app.editCVManually()" class="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 font-bold hover:bg-slate-100 transition-colors">
                        Edit manually
                    </button>
                    <button onclick="window.app.applyCVExtracted()" class="flex-1 btn-gradient text-white font-bold rounded-lg transition-all">
                        Save to profile
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    closeCVReviewModal() {
        const modal = document.getElementById('cv-review-modal');
        if (modal) modal.remove();
    },

    editCVManually() {
        this.closeCVReviewModal();
        document.getElementById('profile-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    splitCVList(value) {
        return String(value || '').split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
    },

    collectCVRows(selector, arrayKeys = []) {
        return Array.from(document.querySelectorAll(selector)).map((row) => {
            const result = {};
            row.querySelectorAll('[data-key]').forEach((field) => {
                result[field.dataset.key] = arrayKeys.includes(field.dataset.key) ? this.splitCVList(field.value) : field.value.trim();
            });
            return result;
        });
    },

    applyCVExtracted() {
        const value = (id) => document.getElementById(id)?.value.trim() || '';
        const confidence = this._cvRawParsed?.confidence || {};
        const parsed = this.normalizeCVData({
            name: value('cv-review-name'), email: value('cv-review-email'), phone: value('cv-review-phone'),
            location: value('cv-review-location'), targetRole: value('cv-review-role'), summary: value('cv-review-summary'),
            education: this.collectCVRows('.cv-education-item'), relevantCourses: this.splitCVList(value('cv-review-courses')),
            skills: {
                programmingLanguages: this.splitCVList(value('cv-skills-programmingLanguages')),
                frameworks: this.splitCVList(value('cv-skills-frameworks')), tools: this.splitCVList(value('cv-skills-tools')),
                databases: this.splitCVList(value('cv-skills-databases')), softSkills: this.splitCVList(value('cv-skills-softSkills')),
                other: this.splitCVList(value('cv-skills-other'))
            },
            experience: this.collectCVRows('.cv-experience-item', ['skillsUsed']),
            projects: this.collectCVRows('.cv-project-item', ['technologies']),
            certifications: this.splitCVList(value('cv-review-certifications')),
            languages: this.splitCVList(value('cv-review-languages')), missingFields: this._cvRawParsed?.missingFields || [], confidence
        });
        const allSkills = Object.values(parsed.skills).flat().join(', ');
        const experienceText = parsed.experience.map((item) => [item.title, item.organization, [item.startDate, item.endDate].filter(Boolean).join(' – '), item.description, item.skillsUsed.join(', ')].filter(Boolean).join(' | ')).join('\n');
        const projectText = parsed.projects.map((item) => [`Project: ${item.name}`, item.role, item.description, item.technologies.join(', '), item.impact].filter(Boolean).join(' | ')).join('\n');
        const fields = [
            { id: 'prof-name', value: parsed.name, confidence: confidence.name, stateKey: 'name' },
            { id: 'prof-target-role', value: parsed.targetRole, confidence: 'medium', stateKey: 'targetRole' },
            { id: 'prof-location', value: parsed.location, confidence: 'medium', stateKey: 'location' },
            { id: 'prof-phone', value: parsed.phone, confidence: 'medium', stateKey: 'phone' },
            { id: 'prof-summary', value: parsed.summary, confidence: 'medium', stateKey: 'summary' },
            { id: 'prof-skills', value: allSkills, confidence: confidence.skills, stateKey: 'skills' },
            { id: 'prof-courses', value: parsed.relevantCourses.join(', '), confidence: confidence.education, stateKey: 'courses' },
            { id: 'prof-projects', value: projectText, confidence: confidence.projects, stateKey: 'projects' },
            { id: 'prof-experience', value: experienceText, confidence: confidence.experience, stateKey: 'experience' },
            { id: 'prof-certifications', value: parsed.certifications.join('\n'), confidence: 'medium', stateKey: 'certifications' },
            { id: 'prof-languages', value: parsed.languages.join('\n'), confidence: 'medium', stateKey: 'languages' }
        ];
        const saved = [];
        const skipped = [];
        fields.forEach((field) => {
            const element = document.getElementById(field.id);
            const existing = element?.value.trim() || String(this.state.user[field.stateKey] || '').trim();
            if (!field.value) return skipped.push(`${field.stateKey}: empty`);
            if (existing && field.confidence === 'low') return skipped.push(`${field.stateKey}: low confidence`);
            if (element) element.value = field.value;
            this.state.user[field.stateKey] = field.value;
            saved.push(field.stateKey);
        });
        const existingCV = this.normalizeCVData(this.state.user.cvData || {});
        if (confidence.education === 'low' && existingCV.education.length) {
            parsed.education = existingCV.education;
            skipped.push('education: low confidence');
        }
        if (confidence.skills === 'low' && Object.values(existingCV.skills).some((items) => items.length)) parsed.skills = existingCV.skills;
        if (confidence.experience === 'low' && existingCV.experience.length) parsed.experience = existingCV.experience;
        if (confidence.projects === 'low' && existingCV.projects.length) parsed.projects = existingCV.projects;
        this.state.user.cvData = parsed;
        saved.push('cvData');
        this.renderProfileEducation(parsed.education);
        this.saveUserData();
        this.debugCV('fields saved to profile', saved);
        this.debugCV('fields skipped because of low confidence or empty values', skipped);

        if (typeof Logger !== 'undefined') {
            Logger.logCVSubmission(this.state.user, parsed);
        }

        // Show success message
        const status = document.getElementById('cv-import-status');
        if (status) {
            status.textContent = `✓ CV information saved to your profile${skipped.length ? '; existing low-confidence fields were kept.' : '.'}`;
            status.classList.remove('hidden', 'text-red-600', 'text-slate-600');
            status.classList.add('text-green-600');
            document.getElementById('cv-fallback-actions')?.classList.add('hidden');
            setTimeout(() => status.classList.add('hidden'), 3000);
        }

        this.closeCVReviewModal();
    },

    // Improved CV parsing with better extraction
    parseCVText(text) {
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        const textLower = text.toLowerCase();

        const extracted = {
            name: this.extractName(text, lines),
            field: this.detectField(textLower),
            linkedin: this.extractLinkedIn(text),
            skills: this.extractSkills(text, textLower),
            education: this.extractEducation(text, lines, textLower),
            experience: this.extractExperience(text, lines, textLower),
            courses: this.extractCourses(text, textLower),
            projects: this.extractProjects(text, lines, textLower),
            certifications: this.extractCertifications(text, textLower),
            languages: this.extractLanguages(text, textLower),
            tools: this.extractTools(text, textLower)
        };

        // Format for legacy compatibility
        return {
            name: extracted.name,
            field: extracted.field,
            linkedin: extracted.linkedin,
            skills: extracted.skills.join(', '),
            experience: extracted.experience,
            courses: extracted.courses.join(', '),
            // Store structured data for review
            _extracted: extracted
        };
    },

    extractLinkedIn(text) {
        const match = text.match(/linkedin\.com\/in\/[a-zA-Z0-9-]+\/?/);
        return match ? 'https://www.' + match[0] : '';
    },

    extractName(text, lines) {
        // First line is often the name
        const firstLine = lines[0] || '';
        if (firstLine && firstLine.length < 50 && !firstLine.match(/^\d/) && !firstLine.match(/^[A-Z\s]+$/)) {
            // Check if it looks like a name (no special symbols, reasonable length)
            if (!firstLine.match(/[|•·]/)) {
                return firstLine;
            }
        }
        return '';
    },

    extractSkills(text, textLower) {
        const skills = [];
        const seenSkills = new Set();

        // Technical skills library (comprehensive)
        const TECH_SKILLS = [
            // Languages
            'Python', 'JavaScript', 'TypeScript', 'Java', 'C++', 'C#', 'PHP', 'Ruby', 'Go', 'Rust', 'Swift', 'Kotlin',
            'R', 'MATLAB', 'Scala', 'Perl', 'Haskell', 'Elixir', 'Clojure',
            // Frontend
            'React', 'Vue', 'Angular', 'Svelte', 'Next.js', 'Nuxt', 'Ember', 'Backbone',
            'HTML', 'CSS', 'Sass', 'Bootstrap', 'Tailwind', 'Material UI',
            // Backend
            'Node.js', 'Express', 'Django', 'Flask', 'FastAPI', 'Spring', 'Spring Boot', 'ASP.NET',
            'Laravel', 'Ruby on Rails', 'Gin', 'Echo', 'Rocket',
            // Databases
            'SQL', 'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Cassandra', 'DynamoDB', 'Elasticsearch',
            'Oracle', 'SQLite', 'MariaDB', 'Neo4j', 'Firestore',
            // Data & Analytics
            'Pandas', 'NumPy', 'Scikit-learn', 'TensorFlow', 'PyTorch', 'Keras', 'Matplotlib',
            'Plotly', 'Tableau', 'Power BI', 'Looker', 'Qlik', 'Excel',
            // Cloud & DevOps
            'AWS', 'Azure', 'GCP', 'Google Cloud', 'Heroku', 'DigitalOcean',
            'Docker', 'Kubernetes', 'Jenkins', 'GitLab CI', 'GitHub Actions', 'CircleCI',
            'Terraform', 'Ansible', 'CloudFormation',
            // Data Tools
            'Jupyter', 'Apache Spark', 'Hadoop', 'Kafka', 'RabbitMQ', 'Airflow',
            'Databricks', 'Snowflake', 'BigQuery', 'Redshift',
            // Version Control & Tools
            'Git', 'GitHub', 'GitLab', 'Bitbucket', 'SVN',
            'Jira', 'Confluence', 'Linear', 'Asana', 'Monday.com',
            // APIs & Protocols
            'REST', 'GraphQL', 'gRPC', 'SOAP', 'WebSocket',
            // Other
            'Linux', 'Windows', 'macOS', 'Unix',
            'Agile', 'Scrum', 'Kanban', 'Waterfall',
            'Communication', 'Leadership', 'Problem Solving', 'Teamwork', 'Collaboration',
            'Analysis', 'Design', 'Testing', 'Debugging', 'Optimization'
        ];

        // Look for skills section first
        const skillsPattern = /(?:technical\s+)?skills?\s*:?\s*\n([\s\S]*?)(?:\n\n|$|\n(?:[A-Z][a-z]+\s*:|\w+\s+(?:Experience|History|Projects|Education)))/im;
        const skillsMatch = text.match(skillsPattern);

        if (skillsMatch && skillsMatch[1]) {
            const skillsText = skillsMatch[1];
            const skillLines = skillsText.split(/\n|,|;|•|·/).map(s => s.trim()).filter(Boolean);

            skillLines.forEach(line => {
                TECH_SKILLS.forEach(skill => {
                    if (line.toLowerCase().includes(skill.toLowerCase())) {
                        if (!seenSkills.has(skill)) {
                            skills.push(skill);
                            seenSkills.add(skill);
                        }
                    }
                });
            });
        }

        // Fallback: scan entire CV for tech skills
        if (skills.length === 0) {
            TECH_SKILLS.forEach(skill => {
                if (textLower.includes(skill.toLowerCase()) && !seenSkills.has(skill)) {
                    skills.push(skill);
                    seenSkills.add(skill);
                }
            });
        }

        return skills.slice(0, 15);
    },

    extractEducation(text, lines, textLower) {
        const education = [];

        // Find education section
        const eduPattern = /(?:education|academic|university|school|degree)\s*:?\s*\n([\s\S]*?)(?:\n\n|$|\n(?:[A-Z][a-z]+\s*:))/im;
        const eduMatch = text.match(eduPattern);

        if (eduMatch && eduMatch[1]) {
            const eduText = eduMatch[1];
            const eduLines = eduText.split('\n').map(l => l.trim()).filter(Boolean);

            eduLines.forEach((line, idx) => {
                // Look for degree/school patterns
                if (line.length > 15 && line.length < 150) {
                    if (/(bachelor|master|phd|diploma|certificate|degree|b\.s\.|m\.s\.|b\.a\.|m\.a\.|b\.tech|m\.tech)/i.test(line)) {
                        education.push(line);
                    } else if (idx < eduLines.length - 1 && /(university|college|school|institute)/i.test(line)) {
                        education.push(line);
                    }
                }
            });
        }

        return education.slice(0, 5);
    },

    extractExperience(text, lines, textLower) {
        // Extract detailed work experience
        const expPattern = /(?:work\s+)?experience|employment|professional\s+background\s*:?\s*\n([\s\S]*?)(?:\n\n|$|\n(?:[A-Z][a-z]+\s*:|\w+\s+(?:Projects|Skills|Education)))/im;
        const expMatch = text.match(expPattern);

        if (expMatch && expMatch[1]) {
            const expText = expMatch[1];
            // Take first 600 chars of experience section
            let cleaned = expText.split('\n')
                .map(l => l.trim())
                .filter(l => l.length > 10)
                .slice(0, 6)
                .join(' ');
            return cleaned.substring(0, 600);
        }
        return '';
    },

    extractCourses(text, textLower) {
        const courses = [];
        const seenCourses = new Set();

        const courseKeywords = [
            'data structures', 'algorithms', 'database design', 'web development', 'software engineering',
            'machine learning', 'deep learning', 'statistics', 'probability', 'linear algebra', 'calculus',
            'discrete mathematics', 'operating systems', 'computer networks', 'distributed systems',
            'data science', 'big data', 'cloud computing', 'cybersecurity', 'cryptography',
            'artificial intelligence', 'computer vision', 'natural language processing', 'reinforcement learning',
            'system design', 'design patterns', 'agile', 'devops', 'full stack'
        ];

        const coursesPattern = /(?:relevant\s+)?coursework|relevant\s+courses|courses?\s*:?\s*\n([\s\S]*?)(?:\n\n|$|\n[A-Z][a-z]+\s*:)/im;
        const coursesMatch = text.match(coursesPattern);

        if (coursesMatch && coursesMatch[1]) {
            const coursesText = coursesMatch[1];
            const courseLines = coursesText.split(/\n|,|;/).map(s => s.trim()).filter(Boolean);

            courseLines.forEach(line => {
                courseKeywords.forEach(kw => {
                    if (line.toLowerCase().includes(kw)) {
                        if (!seenCourses.has(kw)) {
                            courses.push(kw);
                            seenCourses.add(kw);
                        }
                    }
                });
            });
        } else {
            // Fallback: look in entire text
            courseKeywords.forEach(kw => {
                if (textLower.includes(kw) && !seenCourses.has(kw)) {
                    courses.push(kw);
                    seenCourses.add(kw);
                }
            });
        }

        return courses.slice(0, 8);
    },

    extractProjects(text, lines, textLower) {
        const projects = [];

        const projectPattern = /(?:projects?|portfolio)\s*:?\s*\n([\s\S]*?)(?:\n\n|$|\n[A-Z][a-z]+\s*:)/im;
        const projectMatch = text.match(projectPattern);

        if (projectMatch && projectMatch[1]) {
            const projectText = projectMatch[1];
            const projectLines = projectText.split('\n').map(l => l.trim()).filter(l => l.length > 15 && l.length < 150);

            projectLines.forEach(line => {
                if (!line.match(/^\d/) && !line.match(/^[-•*]/)) {
                    projects.push(line);
                }
            });
        }

        return projects.slice(0, 5);
    },

    extractCertifications(text, textLower) {
        const certs = [];

        const certPattern = /(?:certifications?|certificates?|licenses?|awards?)\s*:?\s*\n([\s\S]*?)(?:\n\n|$|\n[A-Z][a-z]+\s*:)/im;
        const certMatch = text.match(certPattern);

        if (certMatch && certMatch[1]) {
            const certText = certMatch[1];
            const certLines = certText.split(/\n|,/).map(s => s.trim()).filter(s => s.length > 5 && s.length < 100);
            return certLines.slice(0, 5);
        }
        return certs;
    },

    extractLanguages(text, textLower) {
        const languages = [];
        const langPattern = /(?:language|languages?)\s*:?\s*\n?([\s\S]*?)(?:\n\n|$|\n[A-Z][a-z]+\s*:)/im;
        const langMatch = text.match(langPattern);

        if (langMatch && langMatch[1]) {
            const langText = langMatch[1];
            const langList = langText.split(/\n|,/).map(s => s.trim()).filter(s => s.length > 2 && s.length < 30);
            return langList.slice(0, 5);
        }
        return languages;
    },

    extractTools(text, textLower) {
        const tools = [];
        const seenTools = new Set();

        const TOOLS = [
            'Figma', 'Adobe XD', 'Sketch', 'InVision', 'Framer',
            'Photoshop', 'Illustrator', 'After Effects',
            'Slack', 'Teams', 'Discord', 'Zoom',
            'Notion', 'Obsidian', 'OneNote',
            'VS Code', 'IntelliJ', 'Visual Studio', 'Xcode',
            'Postman', 'Insomnia', 'Thunder Client',
            'Figma', 'Adobe Analytics', 'Mixpanel', 'Amplitude',
            'Stripe', 'Twilio', 'SendGrid', 'Auth0'
        ];

        TOOLS.forEach(tool => {
            if (textLower.includes(tool.toLowerCase()) && !seenTools.has(tool)) {
                tools.push(tool);
                seenTools.add(tool);
            }
        });

        return tools.slice(0, 8);
    },

    detectField(textLower) {
        const FIELD_MAP = [
            { keywords: ['machine learning', 'deep learning', 'neural', 'nlp', 'computer vision', 'tensorflow', 'pytorch'], field: 'Artificial Intelligence' },
            { keywords: ['data science', 'data analyst', 'pandas', 'numpy', 'tableau', 'power bi', 'analytics'], field: 'Data Science' },
            { keywords: ['software engineer', 'backend', 'frontend', 'fullstack', 'web developer', 'mobile app'], field: 'Software Engineering' },
            { keywords: ['cybersecurity', 'penetration', 'ethical hack', 'infosec', 'security'], field: 'Cybersecurity' },
            { keywords: ['devops', 'kubernetes', 'terraform', 'ci/cd', 'infrastructure', 'cloud engineer'], field: 'Cloud / DevOps' },
            { keywords: ['ux ', 'ui ', 'user experience', 'user research', 'usability', 'figma'], field: 'UX Research' },
            { keywords: ['finance', 'investment', 'portfolio', 'equity', 'accounting'], field: 'Finance' },
            { keywords: ['marketing', 'seo', 'campaigns', 'brand', 'content', 'digital marketing'], field: 'Digital Marketing' },
            { keywords: ['product manager', 'product management', 'roadmap', 'go-to-market'], field: 'Business Administration' },
        ];

        for (const { keywords, field } of FIELD_MAP) {
            if (keywords.some(k => textLower.includes(k))) {
                return field;
            }
        }

        return 'Software Engineering'; // default
    },

    async handleJobSubmit() {
        const descEl = document.getElementById('job-desc-input');
        this.state.job.description = descEl ? descEl.value.trim() : '';
        await this.runAnalysis();
    },

    continueAsGuest() {
        this.state.isGuest = true;
        this.state.currentUser = { email: 'guest@prepwise.local', profile: this.state.user, sessions: [], isGuest: true };
        this.updateUserUI();
        this.openEditProfile();
    },

    updateUserUI() {
        const pill = document.getElementById('user-pill');
        const pillName = document.getElementById('pill-name');
        const pillInitials = document.getElementById('pill-initials');
        const navAvatar = document.getElementById('nav-user-avatar');
        
        const name = this.state.user.name || (this.state.isGuest ? 'Guest User' : '');
        const initials = name ? name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : 'U';

        if (navAvatar) navAvatar.textContent = initials;

        if (this.state.isGuest) {
            if (pillName) pillName.textContent = 'Hi, Guest!';
            if (pillInitials) pillInitials.textContent = 'G';
            if (pill) pill.classList.remove('hidden');
            return;
        }
        
        if (!this.state.user.name) {
            this.renderProfileSummary();
            return;
        }
        
        const firstName = this.state.user.name.split(' ')[0];
        if (pillName) pillName.textContent = `Hi, ${firstName}!`;
        if (pillInitials) pillInitials.textContent = initials;
        if (pill) pill.classList.remove('hidden');
        this.renderProfileSummary();
    },

    saveUserData() {
        if (this.state.isGuest || !this.state.currentUser) return;
        const users = JSON.parse(localStorage.getItem('prepwise_users_v3') || '{}');
        const email = this.state.currentUser.email;
        if (!users[email]) users[email] = { profile: null, sessions: [] };
        users[email].profile = this.state.user;
        users[email].sessions = this.state.sessions;
        localStorage.setItem('prepwise_users_v3', JSON.stringify(users));
        localStorage.setItem('prepwise_session_v3', JSON.stringify({ email, ...users[email] }));
    },

    signOut() {
        localStorage.removeItem('prepwise_session_v3');
        this.state.currentUser = null;
        this.state.isGuest = false;
        location.reload();
    },

    deleteAccount() {
        if (!this.state.currentUser || !this.state.currentUser.email) {
            alert('No account to delete.');
            return;
        }
        const confirmed = confirm('Delete your account?\n\nThis will permanently remove your profile and all session history. This cannot be undone.');
        if (!confirmed) return;
        const email = this.state.currentUser.email;
        const users = JSON.parse(localStorage.getItem('prepwise_users_v3') || '{}');
        delete users[email];
        localStorage.setItem('prepwise_users_v3', JSON.stringify(users));
        localStorage.removeItem('prepwise_session_v3');
        location.reload();
    },

    // --- Navigation ---
    handleLogoClick() {
        if (this.state.currentStage === 0) return;
        if (this.state.currentStage === 4) {
            if (!confirm("Leave the interview? Your progress will not be saved.")) return;
            this.stopListening();
            window.speechSynthesis && window.speechSynthesis.cancel();
        }
        if (this.state.currentUser && this.state.currentUser.profile) {
            this.showDashboard();
        } else {
            this.goToStage(0);
        }
    },

    goBack() {
        const stage = this.state.currentStage;
        if (stage === 4) {
            if (!confirm("Leave the interview? Your progress will not be saved.")) return;
            this.stopListening();
            window.speechSynthesis && window.speechSynthesis.cancel();
            this.goToStage(3);
        } else if (stage === 5) {
            this.showDashboard();
        } else if (stage === 6) {
            this.goToStage(5);
        } else if (stage > 0) {
            this.goToStage(stage - 1);
        }
    },

    showDashboard() {
        this.goToStage(1);
    },

    goToStage(stageNum) {
        if (stageNum === 1) {
            this._updateDashboardUI();
        }
        if (stageNum === 3) {
            this.state.wizard.step = 1;
            this.renderWizardStep();
        }
        this._navigateToStage(stageNum);
        const hash = STAGE_HASHES[stageNum] || '';
        if (stageNum === 0) {
            history.replaceState({ stage: stageNum }, '', window.location.pathname);
        } else {
            history.pushState({ stage: stageNum }, '', hash);
        }
    },

    _navigateToStage(stageNum) {
        this.state.currentStage = stageNum;
        const viewKeys = ['auth', 'dashboard', 'profile', 'setup', 'interview', 'completion', 'report', 'practice', 'history'];
        Object.values(this.views).forEach(v => { if (v) v.classList.remove('active'); });
        const key = viewKeys[stageNum];
        if (this.views[key]) this.views[key].classList.add('active');
        
        // Show/Hide App Navigation
        if (this.nav) {
            if (stageNum === 0) {
                this.nav.classList.add('hidden');
            } else {
                this.nav.classList.remove('hidden');
            }
        }
        const mobileNav = document.getElementById('mobile-nav');
        if (mobileNav) {
            mobileNav.classList.toggle('hidden', stageNum === 0);
            mobileNav.classList.toggle('flex', stageNum !== 0);
        }
        document.querySelectorAll('[data-nav-stage]').forEach((link) => {
            link.classList.toggle('active', Number(link.dataset.navStage) === stageNum);
        });

        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        if (stageNum === 8) this.showHistory();

        if (typeof lucide !== 'undefined') lucide.createIcons();
    },



    extractRequirements(jobDesc) {
        const softSkillWords = [
            'communication', 'interpersonal', 'leadership', 'teamwork', 'collaboration',
            'adaptability', 'time management', 'organizational', 'work ethic', 'multitask',
            'self-starter', 'proactive', 'driven', 'motivated', 'enthusiasm', 'passionate',
            'attention to detail', 'critical thinking', 'problem solving', 'fast paced',
            'fast learner', 'team player', 'verbal', 'written communication', 'positive attitude',
            'strong work ethic', 'ability to work', 'ability to communicate', 'people skills',
            'relationship', 'initiative', 'flexible', 'reliable', 'responsible'
        ];
        const techKeywords = [
            'python', 'javascript', 'java', 'sql', 'react', 'node', 'aws', 'docker',
            'kubernetes', 'typescript', 'api', 'database', 'machine learning', 'data',
            'framework', 'library', 'algorithm', 'software', 'system', 'architecture',
            'bachelor', 'master', 'degree', 'major', 'gpa', 'course', 'graduate',
            'engineering', 'computer science', 'mathematics', 'statistics', 'physics',
            'research', 'thesis', 'publication', 'internship', 'project', 'build',
            'develop', 'design', 'implement', 'deploy', 'cloud', 'git', 'linux',
            'analysis', 'model', 'network', 'security', 'devops', 'backend', 'frontend',
            'mobile', 'ios', 'android', 'html', 'css', 'php', 'ruby', 'c++', 'scala',
            'testing', 'agile', 'scrum', 'ci/cd', 'microservice', 'rest', 'graphql'
        ];

        const isSoftSkillOnly = (line) => {
            const lower = line.toLowerCase();
            const hasTech = techKeywords.some(kw => lower.includes(kw));
            if (hasTech) return false;
            const hasSoft = softSkillWords.some(kw => lower.includes(kw));
            return hasSoft;
        };

        const lines = jobDesc.split('\n').map(l => l.trim()).filter(Boolean);
        const reqLines = lines.filter(l =>
            /^[-•*]|^\d+\.|experience|proficien|knowledge|familiar|skill|must|required|ability/i.test(l)
        );
        const requirements = reqLines
            .filter(l => !isSoftSkillOnly(l))
            .map(l => l.replace(/^[-•*\d.]+\s*/, '').replace(/\(.*?\)/g, '').trim())
            .filter(l => l.length > 5 && l.length < 120);
        return requirements;
    },

    matchRequirements(requirements, userSkillsList) {
        const userLower = userSkillsList.map(s => s.toLowerCase());
        const matched = [], missing = [];
        requirements.forEach(req => {
            const reqLower = req.toLowerCase();
            const isMatch = userLower.some(skill =>
                reqLower.includes(skill) || skill.split(' ').some(word => word.length > 3 && reqLower.includes(word))
            );
            if (isMatch) matched.push(req);
            else missing.push(req);
        });
        return { matched, missing };
    },

    // --- Analysis ---
    async runAnalysis() {
        const jobDesc = this.state.job.description;
        const userProfile = JSON.stringify(this.state.user);

        const el = (id) => document.getElementById(id);
        const statusEl = el('job-desc-status') || el('interviewer-status');
        
        // Safety check for API key
        const apiKey = window.PREPWISE_CONFIG?.GEMINI_API_KEY || localStorage.getItem('gemini_api_key');
        if (!apiKey || apiKey === 'PASTE_YOUR_KEY_HERE') {
            alert("API Key missing! Please open config.js and paste your Gemini API key.");
            return;
        }

        if (statusEl) statusEl.textContent = 'AI is analyzing job requirements...';

        try {
            const prompt = `
                Analyze the following Job Description and Candidate Profile.
                Job Description: ${jobDesc}
                Candidate Profile: ${userProfile}

                Provide a detailed match analysis in JSON format:
                {
                    "matchScore": number (0-100),
                    "strengths": ["string", "string", ... max 4],
                    "gaps": ["string", "string", ... max 6],
                    "topics": ["string", "string", ... max 3 focus topics for practice],
                    "difficulty": "Easy" | "Moderate" | "Challenging" | "Expert"
                }
            `;

            const geminiResponseText = await this.callModelAPI(prompt, "You are a senior technical recruiter. Always respond in valid JSON.", true);
            if (!geminiResponseText) throw new Error("No response from AI");

            const jsonMatch = geminiResponseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("Invalid AI response format");
            
            const result = JSON.parse(jsonMatch[0]);

            this.state.analysis = {
                matchScore: result.matchScore || 50,
                strengths: result.strengths || [],
                gaps: result.gaps || [],
                topics: result.topics || [],
                difficulty: result.difficulty || "Moderate"
            };

            const matchScore = this.state.analysis.matchScore;
            const diffLevel = matchScore > 85 ? 2 : (matchScore > 70 ? 3 : 4);

            if (el('match-score')) el('match-score').textContent = `${matchScore}%`;
            if (el('difficulty-text')) el('difficulty-text').textContent = this.state.analysis.difficulty;
            if (el('difficulty-dots')) {
                Array.from(el('difficulty-dots').children).forEach((dot, i) => {
                    dot.className = `w-3.5 h-3.5 rounded-full ${i < diffLevel ? 'bg-accent-lavender shadow-[0_0_10px_rgba(155,138,251,0.4)]' : 'bg-slate-200'}`;
                });
            }

            const renderRequirement = (req, icon, iconColor) => `
                <li class="flex items-start gap-2.5 p-2.5 bg-slate-50 rounded-lg border border-slate-100 text-xs font-medium text-brand-900 leading-snug">
                    <i data-lucide="${icon}" class="w-3.5 h-3.5 ${iconColor} mt-0.5 shrink-0"></i>
                    ${req}
                </li>
            `;

            if (el('analysis-strengths')) el('analysis-strengths').innerHTML = this.state.analysis.strengths.map(s => renderRequirement(s, 'check', 'text-[#63D5C4]')).join('');
            if (el('analysis-gaps')) el('analysis-gaps').innerHTML = this.state.analysis.gaps.map(g => renderRequirement(g, 'minus', 'text-red-400')).join('');
            if (el('analysis-topics')) el('analysis-topics').innerHTML = this.state.analysis.topics.map(t => renderRequirement(t, 'circle-dot', 'text-brand-500')).join('');

            if (el('job-input-section')) el('job-input-section').classList.add('hidden');
            if (el('analysis-results-section')) el('analysis-results-section').classList.remove('hidden');
            if (typeof lucide !== 'undefined') lucide.createIcons();

        } catch (error) {
            console.error("Analysis Error:", error);
            if (statusEl) statusEl.textContent = 'Error: ' + error.message;
            alert("AI Analysis failed. Check your API key and connection.");
        }
    },

    extractJobKeywords(jobDesc) {
        const techSkills = ['python', 'javascript', 'java', 'sql', 'react', 'node.js', 'node', 'aws', 'docker', 'kubernetes', 'typescript', 'c++', 'go', 'rust', 'scala', 'spring', 'django', 'flask', 'angular', 'vue', 'backend', 'frontend', 'fullstack', 'devops', 'cloud', 'api', 'rest', 'graphql', 'microservices', 'databases', 'mongodb', 'postgres', 'postgresql', 'mysql', 'redis', 'elasticsearch', 'machine learning', 'data analysis', 'analytics', 'ai', 'gcp', 'azure', 'terraform', 'jenkins', 'git', 'html', 'css'];
        const softSkills = ['communication', 'leadership', 'teamwork', 'collaboration', 'problem solving', 'critical thinking', 'project management', 'agile', 'scrum', 'stakeholder', 'mentoring', 'presentation', 'negotiation', 'strategic', 'organizational'];
        const responsibilities = ['design', 'architect', 'develop', 'build', 'implement', 'debug', 'test', 'optimize', 'analyze', 'research', 'manage', 'lead', 'mentor', 'review', 'document', 'maintain', 'improve', 'create'];

        const found = { tech: [], soft: [], responsibilities: [] };

        techSkills.forEach(s => { if (jobDesc.includes(s)) found.tech.push(s); });
        softSkills.forEach(s => { if (jobDesc.includes(s)) found.soft.push(s); });
        responsibilities.forEach(r => { if (jobDesc.includes(r)) found.responsibilities.push(r); });

        return found;
    },

    calculateMatchScore(jobKeywords, userSkillsList, userField, jobDesc) {
        let score = 50;
        const userSkillsLower = userSkillsList.map(s => s.toLowerCase());
        const jobDescLower = jobDesc.toLowerCase();

        // Count how many job tech skills user has
        const userHasTechSkills = jobKeywords.tech.filter(skill =>
            userSkillsLower.some(us => us.includes(skill) || skill.includes(us.split(' ')[0]))
        ).length;

        // More sophisticated tech skill matching
        const techCoverage = jobKeywords.tech.length > 0 ? (userHasTechSkills / jobKeywords.tech.length) : 0;
        if (techCoverage > 0.8) score += 25;
        else if (techCoverage > 0.6) score += 18;
        else if (techCoverage > 0.4) score += 12;
        else if (techCoverage > 0.2) score += 6;
        else if (techCoverage > 0) score += 2;

        // Soft skills - more lenient, assume people have communication
        const userHasSoftSkills = jobKeywords.soft.filter(skill =>
            userSkillsLower.some(us => us.toLowerCase().includes(skill.split(' ')[0].toLowerCase()))
        ).length;
        const softCoverage = jobKeywords.soft.length > 0 ? (userHasSoftSkills / Math.min(jobKeywords.soft.length, 3)) : 0;
        if (softCoverage > 0.5) score += 5;

        // Field relevance - important bonus
        const fieldMatch = userField.toLowerCase();
        if ((fieldMatch.includes('software') || fieldMatch.includes('computer') || fieldMatch.includes('engineering') || fieldMatch.includes('data')) &&
            (jobDescLower.includes('engineer') || jobDescLower.includes('developer') || jobDescLower.includes('scientist') || jobDescLower.includes('analyst'))) {
            score += 15;
        }

        // Years of experience check
        const expMatch = jobDesc.match(/(\d+)\+?\s*(years?|yrs)/i);
        if (expMatch) {
            const reqYears = parseInt(expMatch[1]);
            if (reqYears <= 3) score += 5;
            else if (reqYears <= 5) score += 3;
        }

        return Math.max(35, Math.min(95, score));
    },

    identifySkillGaps(jobKeywords, userSkillsList) {
        const userSkillsLower = userSkillsList.map(s => s.toLowerCase());
        const gaps = [];

        // Identify most important missing tech skills (first 3-4 mentioned in job desc)
        const missingTechSkills = jobKeywords.tech.filter(skill =>
            !userSkillsLower.some(us => us.includes(skill) || skill.includes(us.split(' ')[0]))
        );

        // Prioritize by frequency in job description (more important = more mentioned)
        // Add top missing tech skills
        missingTechSkills.slice(0, 2).forEach(skill => {
            const formatted = skill.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            if (!gaps.includes(formatted)) gaps.push(formatted);
        });

        // Add missing soft skills if very few matches
        const missingSoftSkills = jobKeywords.soft.filter(skill =>
            !userSkillsLower.some(us => us.toLowerCase().includes(skill.split(' ')[0]))
        );

        if (missingSoftSkills.length > 0 && gaps.length < 3) {
            missingSoftSkills.slice(0, 1).forEach(skill => {
                const formatted = skill.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                if (!gaps.includes(formatted)) gaps.push(formatted);
            });
        }

        return gaps.slice(0, 3);
    },

    getDifficultyLevel(matchScore, gapCount) {
        if (matchScore >= 80) return 'Moderate';
        if (matchScore >= 65) return 'Challenging';
        return 'Advanced';
    },

    extractStrengths(jobKeywords, userSkillsList, userField) {
        const strengths = [];
        const userSkillsLower = userSkillsList.map(s => s.toLowerCase());

        // Add user's relevant skills that match job
        userSkillsList.slice(0, 2).forEach(skill => {
            if (jobKeywords.tech.some(t => skill.toLowerCase().includes(t) || t.includes(skill.toLowerCase().split(' ')[0]))) {
                strengths.push(skill);
            }
        });

        // Add field-specific strengths
        if (userField.includes('software') || userField.includes('computer')) {
            strengths.push('Technical Foundation');
        }
        if (userField.includes('data') || userField.includes('machine')) {
            strengths.push('Analytical Thinking');
        }

        // Generic professional strengths
        if (strengths.length < 3) {
            const genericStrengths = ['Problem Solving', 'Collaboration', 'Learning Agility', 'Communication'];
            genericStrengths.forEach(s => {
                if (strengths.length < 3 && !strengths.includes(s)) {
                    strengths.push(s);
                }
            });
        }

        return strengths.slice(0, 3);
    },

    generateFocusTopics(jobKeywords, gaps, userField) {
        const topics = [];

        // Add top tech skill gap as focus topic
        if (jobKeywords.tech.length > 0) {
            topics.push(jobKeywords.tech[0].charAt(0).toUpperCase() + jobKeywords.tech[0].slice(1) + ' Proficiency');
        }

        // Add soft skill focus
        if (jobKeywords.soft.length > 0) {
            topics.push(jobKeywords.soft[0].charAt(0).toUpperCase() + jobKeywords.soft[0].slice(1));
        }

        // Add role-specific focus
        if (jobKeywords.responsibilities.length > 0) {
            topics.push(jobKeywords.responsibilities[0].charAt(0).toUpperCase() + jobKeywords.responsibilities[0].slice(1) + ' Best Practices');
        }

        // Ensure we have 3 topics
        const fallbacks = ['System Design Patterns', 'STAR Method Storytelling', 'Real-world Problem Solving'];
        fallbacks.forEach(f => {
            if (topics.length < 3 && !topics.includes(f)) {
                topics.push(f);
            }
        });

        return topics.slice(0, 3);
    },

    tryDifferentRole() {
        this.state.job.description = '';
        const jobInput = document.getElementById('job-desc-input');
        if (jobInput) jobInput.value = '';
        const jobSection = document.getElementById('job-input-section');
        const resultsSection = document.getElementById('analysis-results-section');
        if (jobSection) jobSection.classList.remove('hidden');
        if (resultsSection) resultsSection.classList.add('hidden');
    },

    // --- Setup Wizard ---
    selectWizOption(category, value, el) {
        try {
            console.log(`[Wizard] Selecting ${category}: ${value}`);
            
            // Use explicit app reference for state safety
            if (window.app && window.app.state && window.app.state.wizard) {
                window.app.state.wizard[category] = value;
            }

            // Find the parent wizard-step container to clear sibling selections
            const stepContainer = el.closest('.wizard-step');
            if (stepContainer) {
                const options = stepContainer.querySelectorAll('.wizard-option');
                options.forEach(opt => {
                    opt.classList.remove('selected', 'ring-4', 'ring-brand-500/20');
                    // Add a light border back to unselected
                    opt.style.borderColor = '#e2e8f0';
                });
            }
            
            // Apply selection styles to the clicked element
            el.classList.add('selected', 'ring-4', 'ring-brand-500/20');
            el.style.borderColor = '#3b82f6';
            
            // Specific overrides
            if (category === 'mood') window.app.state.interviewerMood = value;
            if (category === 'style') window.app.state.interviewMode = value;

            console.log(`[Wizard] State updated:`, window.app.state.wizard);
        } catch (err) {
            console.error("[Wizard Error] Failed to select option:", err);
        }
    },

    wizardNext() {
        if (this.state.wizard.step === 1 && this.state.wizard.goal === 'specific') {
            this.state.wizard.step = 2;
        } else if (this.state.wizard.step === 1 && this.state.wizard.goal === 'general') {
            this.state.wizard.step = 3;
        } else if (this.state.wizard.step === 2) {
            const jobDescription = document.getElementById('wiz-job-desc')?.value.trim() || '';
            if (jobDescription.length < 40) {
                this.showWizardJobStatus('Add at least a short role summary so the interview can be tailored.', true);
                this.updateWizardControls();
                return;
            }
            this.state.wizard.step = 3;
        } else if (this.state.wizard.step === 3) {
            this.state.wizard.step = 4;
        } else if (this.state.wizard.step === 4) {
            this.state.wizard.step = 5;
        } else if (this.state.wizard.step === 5) {
            this.state.wizard.step = 6;
            this.updateWizardPreview();
        } else if (this.state.wizard.step === 6) {
            this.startWizardInterview();
            return;
        }
        this.renderWizardStep();
    },

    wizardBack() {
        if (this.state.wizard.step === 6) {
            this.state.wizard.step = 5;
        } else if (this.state.wizard.step === 5) {
            this.state.wizard.step = 4;
        } else if (this.state.wizard.step === 4) {
            this.state.wizard.step = 3;
        } else if (this.state.wizard.step === 3 && this.state.wizard.goal === 'specific') {
            this.state.wizard.step = 2;
        } else if (this.state.wizard.step === 3 && this.state.wizard.goal === 'general') {
            this.state.wizard.step = 1;
        } else if (this.state.wizard.step === 2) {
            this.state.wizard.step = 1;
        }
        this.renderWizardStep();
    },

    renderWizardStep() {
        const step = this.state.wizard.step;
        document.querySelectorAll('.wizard-step').forEach(s => s.classList.add('hidden'));
        document.getElementById(`wiz-step-${step}`).classList.remove('hidden');
        
        const prog = document.getElementById('wizard-progress');
        if (prog) prog.style.width = `${(step / 6) * 100}%`;
        const stepLabel = document.getElementById('wizard-step-label');
        if (stepLabel) stepLabel.textContent = `Step ${step} of 6`;

        const backBtn = document.getElementById('wiz-back-btn');
        const nextBtn = document.getElementById('wiz-next-btn');
        
        if (backBtn) backBtn.classList.toggle('invisible', step === 1);
        
        if (nextBtn) {
            if (step === 6) {
                nextBtn.innerHTML = 'Start Interview <i data-lucide="play" class="w-4 h-4 ml-1 inline"></i>';
            } else {
                nextBtn.innerHTML = 'Next <i data-lucide="arrow-right" class="w-4 h-4 ml-1 inline"></i>';
            }
        }
        this.updateWizardControls();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    updateWizardControls() {
        const nextBtn = document.getElementById('wiz-next-btn');
        if (!nextBtn) return;
        const needsDescription = this.state.wizard.step === 2 && this.state.wizard.goal === 'specific';
        const descriptionLength = document.getElementById('wiz-job-desc')?.value.trim().length || 0;
        nextBtn.disabled = needsDescription && descriptionLength < 40;
    },

    showWizardJobStatus(message, isError = false) {
        const status = document.getElementById('wiz-job-status');
        if (!status) return;
        status.textContent = message;
        status.className = `text-xs font-semibold rounded-lg px-3 py-2 ${isError ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}`;
    },

    async handleJobDescriptionUpload(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) return this.showWizardJobStatus('Choose a file smaller than 5MB.', true);
        this.showWizardJobStatus('Reading job description…');
        try {
            let extracted = '';
            if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                const pdf = await pdfjsLib.getDocument(new Uint8Array(await file.arrayBuffer())).promise;
                for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
                    const page = await pdf.getPage(pageNumber);
                    const content = await page.getTextContent();
                    extracted += content.items.map((item) => `${item.str}${item.hasEOL ? '\n' : ' '}`).join('') + '\n';
                }
            } else {
                extracted = await file.text();
            }
            const cleaned = this.cleanCVText(extracted);
            if (cleaned.length < 40) throw new Error('Not enough readable text');
            document.getElementById('wiz-job-desc').value = cleaned.slice(0, 12000);
            this.showWizardJobStatus(`✓ ${file.name} added. Review the text before continuing.`);
            this.updateWizardControls();
        } catch (error) {
            console.error('Job description upload failed:', error);
            this.showWizardJobStatus('We could not read this file. Paste the job description instead.', true);
        }
    },

    updateWizardPreview() {
        const styleMap = { hr: 'HR interview', technical: 'Technical interview', behavioral: 'Behavioral interview', situational: 'Situational interview', mixed: 'Mixed final round' };
        const moodMap = { professional: 'Balanced', friendly: 'Supportive', hard: 'Challenging', casual: 'Casual' };
        const contextMap = { 'specific': 'Specific Job', 'general': 'General Practice' };
        const config = this.getInterviewConfig(this.state.wizard.length);
        
        const styleEl = document.getElementById('wiz-prev-style');
        const moodEl = document.getElementById('wiz-prev-mood');
        const contextEl = document.getElementById('wiz-prev-context');
        const lengthEl = document.getElementById('wiz-prev-length');
        
        if (styleEl) styleEl.textContent = styleMap[this.state.wizard.style] || 'HR / Behavioral';
        if (moodEl) moodEl.textContent = moodMap[this.state.wizard.mood] || 'Professional';
        if (contextEl) contextEl.textContent = contextMap[this.state.wizard.goal] || 'Specific Job';
        if (lengthEl) lengthEl.textContent = config.label;
        const description = document.getElementById('wiz-preview-description');
        if (description) description.textContent = `${config.mainTarget} main questions with up to ${config.maxFollowUps} natural follow-up${config.maxFollowUps === 1 ? '' : 's'}.`;
    },

    startWizardInterview() {
        this.state.interviewMode = this.state.wizard.style;
        this.state.interviewerMood = this.state.wizard.mood;
        const jobDescInput = document.getElementById('wiz-job-desc');
        this.state.job.description = (this.state.wizard.goal === 'specific' && jobDescInput) ? jobDescInput.value : 'General role matching the student profile.';
        this.startInterview();
    },

    showModeSelection() {
        const score = this.state.analysis.matchScore;
        const recommended = score >= 75 ? 'technical' : score >= 55 ? 'hr' : 'behavioral';
        document.querySelectorAll('.mode-card').forEach(card => card.classList.remove('ring-2', 'ring-brand-500'));
        const rec = document.getElementById(`mode-card-${recommended}`);
        if (rec) rec.classList.add('ring-2', 'ring-brand-500');
        document.querySelectorAll('.mode-recommended-badge').forEach(b => b.classList.add('hidden'));
        const badge = document.getElementById(`badge-${recommended}`);
        if (badge) badge.classList.remove('hidden');
        this.goToStage(3);
    },

    selectMode(mode) {
        this.state.interviewMode = mode;
        this.startInterview();
    },

    // --- Realistic Job Interview System ---
    // Technical question library for different domains
    technicalQuestionLibrary() {
        return {
            python: [
                "How would you read a CSV file with pandas and handle missing values?",
                "Can you explain the difference between a list and a dictionary in Python?",
                "How would you write a function to remove duplicates from a list?",
                "What's the difference between == and is in Python?",
                "How would you use list comprehension to filter data?"
            ],
            sql: [
                "How would you write a SQL query to find duplicate records in a table?",
                "What's the difference between a LEFT JOIN and an INNER JOIN?",
                "How would you use GROUP BY and HAVING to summarize data?",
                "Can you explain what an aggregate function like COUNT, SUM, or AVG does?",
                "How would you optimize a slow SQL query?"
            ],
            excel: [
                "How would you use VLOOKUP or INDEX-MATCH to find data in Excel?",
                "Can you explain how you would create a pivot table to summarize sales data?",
                "How would you use conditional formatting to highlight important values?",
                "What formulas would you use to clean data with inconsistent formatting?",
                "How would you calculate summary statistics like mean, median, and standard deviation?"
            ],
            dataVisualization: [
                "When would you use a bar chart versus a line chart?",
                "How would you design a dashboard for a sales manager?",
                "What makes a visualization effective for a non-technical audience?",
                "How would you handle outliers when creating a visualization?",
                "What's important when choosing colors and scales for a chart?"
            ],
            statistics: [
                "Can you explain what correlation means and how it's different from causation?",
                "How would you identify outliers in a dataset?",
                "What's the difference between mean, median, and mode?",
                "When would you use a hypothesis test?",
                "How would you explain statistical significance to a business stakeholder?"
            ],
            dataAnalysis: [
                "Walk me through your process for analyzing a new dataset.",
                "How would you approach a problem where the data shows something unexpected?",
                "Can you describe a time you found an error in data and how you handled it?",
                "How do you validate that your analysis is correct?",
                "What tools and techniques do you use to explore data quickly?"
            ]
        };
    },

    // Question templates for different interview types
    behavioralQuestionTemplates() {
        return [
            "Tell me about a time when you had to work with incomplete or messy data. How did you handle it?",
            "Describe a situation where you had to explain a technical concept to someone without a technical background.",
            "Can you give me an example of when you identified a problem in a process and how you solved it?",
            "Tell me about a time when you had to prioritize multiple tasks. How did you decide what to focus on?",
            "Describe a situation where your first approach didn't work. What did you do?",
            "Can you tell me about a time when you received critical feedback? How did you respond?",
            "Tell me about a project where you had to collaborate with others. What was your role?",
            "Describe a time when you had to learn something new quickly. How did you approach it?"
        ];
    },

    // Scenario-based questions for different roles
    scenarioQuestionTemplates() {
        return {
            dataRole: [
                "You receive a dataset that shows a sudden drop in key metrics last week. Walk me through how you would investigate.",
                "A manager wants to understand why one region is underperforming compared to others. What data would you look at?",
                "You notice that two different reports from the same data show different numbers. How would you find the discrepancy?",
                "You're asked to create a dashboard for executives who want to monitor real-time performance. What would you include?"
            ],
            adminRole: [
                "A staff member asks you to create a new process for reporting hours. How would you approach this?",
                "You discover that important patient/client records are disorganized. How would you fix this?",
                "You need to schedule complex meetings with multiple people. How would you organize this efficiently?",
                "Someone questions a process you implemented. How would you respond?"
            ],
            communicationRole: [
                "You need to explain a complex policy change to team members who are resistant. How would you approach this?",
                "A client is upset with a service. How would you handle the conversation?",
                "You need to present data to a group with mixed technical knowledge. How would you structure it?",
                "You're coordinating a project across multiple departments. How would you keep everyone informed?"
            ]
        };
    },

    // Analyze job description to extract key requirements
    analyzeJobDescription() {
        const jobDesc = this.state.job.description.toLowerCase();
        const skills = {
            python: jobDesc.includes('python'),
            sql: jobDesc.includes('sql'),
            excel: jobDesc.includes('excel') || jobDesc.includes('spreadsheet'),
            dataVisualization: jobDesc.includes('dashboard') || jobDesc.includes('visualization') || jobDesc.includes('tableau') || jobDesc.includes('power bi'),
            statistics: jobDesc.includes('statistical') || jobDesc.includes('statistics'),
            communication: jobDesc.includes('communication') || jobDesc.includes('stakeholder'),
            teamwork: jobDesc.includes('team') || jobDesc.includes('collaboration'),
            problemSolving: jobDesc.includes('problem') || jobDesc.includes('analytical'),
            leadership: jobDesc.includes('lead') || jobDesc.includes('manage'),
            timeManagement: jobDesc.includes('priorit') || jobDesc.includes('multitask')
        };

        const roleType = this.determineRoleType(jobDesc);
        return { skills, roleType };
    },

    determineRoleType(jobDesc) {
        if (jobDesc.includes('data') || jobDesc.includes('analysis') || jobDesc.includes('analyst')) return 'dataRole';
        if (jobDesc.includes('admin') || jobDesc.includes('administrative') || jobDesc.includes('office')) return 'adminRole';
        if (jobDesc.includes('project') || jobDesc.includes('manager')) return 'managerRole';
        if (jobDesc.includes('sales') || jobDesc.includes('account') || jobDesc.includes('customer')) return 'communicationRole';
        if (jobDesc.includes('marketing')) return 'marketingRole';
        return 'generalRole';
    },

    // Detect if user is asking for clarification
    isClarificationRequest(text) {
        const clarificationPatterns = [
            /what do you mean|can you clarify|can you explain|what are you asking|do you mean|repeat that|didn't understand|i'm not sure i understood|are you asking about|could you rephrase|one more time/i
        ];
        return clarificationPatterns.some(pattern => pattern.test(text));
    },

    getTranscribedAnswer() {
        const editArea = document.getElementById('int-answer-area');
        return editArea ? editArea.value.trim() : '';
    },

    clearAnswer() {
        const editArea = document.getElementById('int-answer-area');
        if (editArea) editArea.value = '';
        this.updateAnswerState();
    },

    updateAnswerState() {
        const answer = document.getElementById('int-answer-area')?.value || '';
        const counter = document.getElementById('int-answer-count');
        const submit = document.getElementById('int-submit-btn');
        if (counter) counter.textContent = `${answer.length} character${answer.length === 1 ? '' : 's'}`;
        if (submit && !submit.dataset.loading) submit.disabled = answer.trim().length < 20;
    },

    async clarifyCurrentQuestion() {
        const interview = this.state.interview;
        const questionIndex = interview.currentQuestionIndex;
        const existing = interview.clarificationRequests.find((item) => item.questionIndex === questionIndex);
        if (existing) return this.showQuestionClarification(existing);
        const button = document.getElementById('int-clarify-btn');
        if (button) {
            button.disabled = true;
            button.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Rephrasing…';
        }
        this.setInterviewStatus('Rephrasing the same question without counting an answer…', true);
        try {
            const clarification = await this.postJSON('/api/interview-clarify', {
                current_question: interview.questions[questionIndex],
                interview_stage: interview.currentStage,
                interview_type: this.state.interviewMode,
                question_reason: interview.currentQuestionReason,
                job_description: this.state.job.description,
                student_profile: this.state.user
            });
            const stored = { questionIndex, originalQuestion: interview.questions[questionIndex], ...clarification };
            interview.clarificationRequests.push(stored);
            this.showQuestionClarification(stored);
            this.setInterviewStatus('Question rephrased. Answer the same question when you are ready.');
        } catch (error) {
            console.error('Question clarification failed:', error);
            this.setInterviewStatus('Could not rephrase the question. You can still answer or skip it.');
        } finally {
            if (button) {
                button.disabled = false;
                button.innerHTML = '<i data-lucide="message-circle-question" class="w-4 h-4"></i> Explain / rephrase';
            }
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    },

    showQuestionClarification(clarification) {
        const panel = document.getElementById('int-clarification-panel');
        if (!panel) return;
        panel.classList.remove('hidden');
        const set = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value || ''; };
        set('int-clarified-question', clarification.rephrased_question);
        set('int-clarified-purpose', clarification.what_interviewer_checks);
        set('int-clarified-hint', clarification.answer_hint);
    },

    setInterviewStatus(message, isLoading = false) {
        const status = document.querySelector('#int-ai-state span');
        const container = document.getElementById('int-ai-state');
        if (status) status.textContent = message;
        container?.classList.toggle('animate-pulse', isLoading);
    },

    submitInterviewAnswer() {
        this.handleNextQuestion();
    },

    toggleDictation() {
        const micBtn = document.getElementById('int-mic-btn');
        const micLabel = document.getElementById('int-mic-label');

        if (this.state.interview.isListening) {
            this.stopListening();
            if (micLabel) micLabel.textContent = 'Dictate';
            if (micBtn) micBtn.classList.remove('bg-red-50', 'text-red-600', 'border-red-200');
        } else {
            this.startListening();
            if (micLabel) micLabel.textContent = 'Listening...';
            if (micBtn) micBtn.classList.add('bg-red-50', 'text-red-600', 'border-red-200');
        }
    },

    updateTranscriptDisplay() {
        const editArea = document.getElementById('int-answer-area');
        if (editArea && this.state.transcriptState.final) {
            editArea.value = this.state.transcriptState.final + this.state.transcriptState.interim;
            editArea.scrollTop = editArea.scrollHeight;
        }
    },

    updateInterviewProgress() {
        const timeline = document.getElementById('int-progress-timeline');
        if (!timeline) return;
        const interview = this.state.interview;
        const stages = ['opening', 'role_fit', 'experience', 'behavioral', 'technical', 'closing'];
        const currentStageIndex = Math.max(0, stages.indexOf(interview.currentStage));
        timeline.innerHTML = stages.map((stage, index) => {
            const active = stage === interview.currentStage;
            const past = index < currentStageIndex;
            return `<div class="flex items-center gap-2.5 px-2 py-2 rounded-lg ${active ? 'bg-indigo-50 text-brand-700' : 'text-slate-500'}"><span class="w-5 h-5 rounded-full flex items-center justify-center border ${past ? 'bg-brand-500 border-brand-500 text-white' : active ? 'border-brand-500 bg-white text-brand-600' : 'border-slate-200 bg-white text-slate-300'}"><i data-lucide="${past ? 'check' : active ? 'circle-dot' : 'circle'}" class="w-3 h-3"></i></span><span class="text-xs font-semibold">${this.interviewStageLabel(stage)}</span></div>`;
        }).join('');
        const completed = interview.responses.length;
        const displayedTotal = interview.currentStage === 'closing' ? interview.currentQuestionIndex + 1 : interview.maxQuestions;
        const percentage = Math.min(100, Math.round((completed / displayedTotal) * 100));
        const summary = document.getElementById('int-progress-summary');
        const percent = document.getElementById('int-progress-percent');
        const bar = document.getElementById('int-progress-bar');
        if (summary) summary.textContent = `Question ${interview.currentQuestionIndex + 1} of ${interview.currentStage === 'closing' ? displayedTotal : `up to ${displayedTotal}`}`;
        if (percent) percent.textContent = `${percentage}%`;
        if (bar) bar.style.width = `${percentage}%`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    // --- Interview Logic ---
    askQuestion() {
        const qText = document.getElementById('interviewer-question-text');
        const counter = document.getElementById('int-q-counter');
        const typeLabel = document.getElementById('int-type-label');
        const questionKind = document.getElementById('int-question-kind');
        const stageLabel = document.getElementById('int-stage-label');
        const nextBtn = document.getElementById('int-submit-btn');
        const editArea = document.getElementById('int-answer-area');
        const skipButton = document.getElementById('int-skip-btn');

        const currentQ = this.state.interview.questions[this.state.interview.currentQuestionIndex];
        const currentMeta = this.state.interview.questionMeta[this.state.interview.currentQuestionIndex] || {};

        if (qText) qText.textContent = currentQ;
        
        if (typeof Logger !== 'undefined') {
            Logger.logQuestion(this.state.interview.currentQuestionIndex + 1, currentQ, this.state.interviewMode);
        }
        
        this.state.interview.questionStartTime = new Date();

        if (counter) {
            const count = this.state.interview.currentQuestionIndex + 1;
            counter.textContent = this.state.interview.currentStage === 'closing'
                ? `Question ${count} of ${count}`
                : `Question ${count} of up to ${this.state.interview.maxQuestions}`;
        }
        if (typeLabel) {
            const labels = { hr: 'HR interview', technical: 'Technical interview', behavioral: 'Behavioral interview', situational: 'Situational interview', mixed: 'Mixed final round' };
            typeLabel.textContent = labels[this.state.interviewMode] || `${this.state.interviewMode} interview`;
        }
        if (questionKind) {
            const kinds = { follow_up: 'Follow-up on your answer', technical: 'Job-specific topic', behavioral: 'Behavioral topic', situational: 'Situational scenario', role_fit: 'Role-fit topic', experience: 'From your profile', closing: 'Closing question', opening: 'Opening question' };
            const topic = currentMeta.topic || this.state.interview.currentTopic;
            questionKind.textContent = currentMeta.isFollowUp
                ? `Follow-up${topic ? ` · ${topic}` : ''}`
                : (topic || kinds[this.state.interview.currentQuestionType] || 'New topic');
        }
        if (stageLabel) stageLabel.textContent = this.interviewStageLabel(this.state.interview.currentStage);
        const reason = document.getElementById('int-question-reason');
        if (reason) reason.textContent = this.state.interview.currentQuestionReason || currentMeta.reason || 'This question checks your fit for the role.';
        const headerLength = document.getElementById('int-header-length');
        if (headerLength) headerLength.textContent = this.getInterviewConfig(this.state.interview.length).label;

        if (nextBtn) {
            delete nextBtn.dataset.loading;
            nextBtn.disabled = true;
            nextBtn.innerHTML = 'Submit Answer <i data-lucide="send" class="w-4 h-4 ml-1 inline"></i>';
        }

        if (editArea) {
            editArea.value = '';
            editArea.focus();
        }
        if (skipButton) skipButton.disabled = false;
        document.getElementById('int-clarification-panel')?.classList.add('hidden');
        this.updateAnswerState();
        this.setInterviewStatus(currentMeta.isFollowUp ? 'Follow-up based on your previous answer' : `New ${this.interviewStageLabel(this.state.interview.currentStage).toLowerCase()} topic`);

        this.updateInterviewProgress();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    showAIBridge(data, callback) {
        if (callback) callback();
    },

    completeInterview() {
        const interview = this.state.interview;
        const count = document.getElementById('completion-question-count');
        const answered = interview.responses.filter((response) => response.status !== 'skipped').length;
        if (count) count.textContent = `${answered} answered · ${interview.skippedQuestions.length} skipped`;
        this.goToStage(5);
        setTimeout(() => this.generateFinalReport(), 500);
    },

    localQuestionResult(question, { followUp = false, stage } = {}) {
        const nextStage = stage || this.state.interview.currentStage || 'role_fit';
        return {
            next_question: question,
            reason: 'This question connects your background to the role.',
            question_type: followUp ? 'follow_up' : nextStage,
            interview_stage: nextStage,
            topic: this.interviewStageLabel(nextStage),
            job_requirement: this.state.user.targetRole || this.state.user.field || 'Role fit',
            is_follow_up: followUp
        };
    },

    plannedInterviewStage() {
        const interview = this.state.interview;
        const mainNumber = interview.mainQuestionsAsked + 1;
        if (mainNumber === 1) return 'opening';
        if (interview.length === 'full') {
            if (mainNumber <= 3) return 'role_fit';
            if (mainNumber <= 6) return 'experience';
            if (mainNumber <= 9) return 'behavioral';
            if (mainNumber <= 13) return 'technical';
            return 'closing';
        }
        return ({ 2: 'role_fit', 3: 'experience', 4: 'behavioral', 5: 'technical' })[mainNumber] || 'closing';
    },

    localStageQuestion(stage) {
        const role = this.state.user.targetRole || this.state.user.field || 'this role';
        const skill = this.splitCVList(this.state.user.skills)[0] || 'your core skills';
        const experience = this.state.user.cvData?.projects?.[0]?.name || this.state.user.cvData?.experience?.[0]?.title || 'a relevant project or experience';
        const questions = {
            opening: `Give me a brief introduction to your background and explain which experience best prepares you for ${role}.`,
            role_fit: `Which responsibility in this ${role} opportunity would be most important for you to master first, and why?`,
            experience: `Walk me through ${experience}. What did you personally own, and what result did it produce?`,
            behavioral: `Tell me about a time you had to solve a difficult problem with other people. What was your contribution and the outcome?`,
            technical: `How would you apply ${skill} to solve a realistic problem in this ${role} position? Explain your approach and trade-offs.`,
            closing: `Based on the requirements and your background, why are you a strong fit for this ${role} opportunity?`
        };
        return questions[stage] || questions.role_fit;
    },

    async skipQuestion() {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        this.stopListening();
        const nextBtn = document.getElementById('int-submit-btn');
        const qText = document.getElementById('interviewer-question-text');
        const skipButton = document.getElementById('int-skip-btn');

        if (nextBtn) {
            nextBtn.disabled = true;
            nextBtn.dataset.loading = 'true';
            nextBtn.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Skipping...';
        }
        if (qText) qText.textContent = 'Generating next question...';
        if (skipButton) skipButton.disabled = true;
        this.setInterviewStatus('Question skipped. Moving to the next relevant topic…', true);

        const previousQuestion = this.state.interview.questions[this.state.interview.currentQuestionIndex];

        const currentMeta = this.state.interview.questionMeta[this.state.interview.currentQuestionIndex] || {};
        this.state.interview.latestAnswer = '[Question skipped]';
        this.state.interview.previousQuestion = previousQuestion;
        this.state.interview.transcript.push({ role: 'user', content: '[Candidate skipped this question. This is not an answer.]' });

        if (typeof Logger !== 'undefined') {
            const duration = Math.round((new Date() - this.state.interview.questionStartTime) / 1000);
            Logger.logAnswer(this.state.interview.currentQuestionIndex + 1, '[Skipped]', duration);
        }

        const skipped = {
            question: previousQuestion, stage: currentMeta.stage || this.state.interview.currentStage,
            topic: currentMeta.topic || this.state.interview.currentTopic,
            jobRequirement: currentMeta.jobRequirement || this.state.interview.currentJobRequirement
        };
        this.state.interview.skippedQuestions.push(skipped);
        this.state.interview.responses.push({ ...skipped, answer: '', status: 'skipped', feedback: 'Skipped' });

        if (this.shouldCompleteInterview()) return this.completeInterview();

        try {
            const result = await this.requestInterviewQuestion();
            this.appendGeneratedQuestion(result);
            this.state.interview.currentQuestionIndex++;
            this.resetTranscriptState();

            this.askQuestion();
        } catch (error) {
            console.error('Could not generate the next question; using local fallback:', error);
            const stage = this.plannedInterviewStage();
            this.appendGeneratedQuestion(this.localQuestionResult(this.localStageQuestion(stage), { stage }));
            this.state.interview.currentQuestionIndex++;
            this.resetTranscriptState();
            this.askQuestion();
        }
    },

    async handleNextQuestion() {
        const answer = this.getTranscribedAnswer();
        if (!answer || answer.length < 5) return;

        this.stopListening();
        const nextBtn = document.getElementById('int-submit-btn');
        const qText = document.getElementById('interviewer-question-text');

        if (nextBtn) {
            nextBtn.disabled = true;
            nextBtn.dataset.loading = 'true';
            nextBtn.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Crafting next question...';
        }
        this.setInterviewStatus('Reviewing your answer and choosing the best next question…', true);

        const previousQuestion = this.state.interview.questions[this.state.interview.currentQuestionIndex];

        this.state.interview.latestAnswer = answer;
        this.state.interview.previousQuestion = previousQuestion;
        this.state.interview.transcript.push({ role: "user", content: answer });

        if (typeof Logger !== 'undefined') {
            const duration = Math.round((new Date() - this.state.interview.questionStartTime) / 1000);
            Logger.logAnswer(this.state.interview.currentQuestionIndex + 1, answer, duration);
        }

        if (qText) qText.textContent = 'Crafting next question...';
        
        const currentMeta = this.state.interview.questionMeta[this.state.interview.currentQuestionIndex] || {};
        this.state.interview.responses.push({
            question: previousQuestion, answer, status: 'answered', feedback: 'Analyzed',
            stage: currentMeta.stage || this.state.interview.currentStage,
            topic: currentMeta.topic || this.state.interview.currentTopic,
            jobRequirement: currentMeta.jobRequirement || this.state.interview.currentJobRequirement,
            clarificationRequested: this.state.interview.clarificationRequests.some((item) => item.questionIndex === this.state.interview.currentQuestionIndex)
        });

        if (this.shouldCompleteInterview()) return this.completeInterview();

        try {
            const result = await this.requestInterviewQuestion();
            this.appendGeneratedQuestion(result);
            this.state.interview.currentQuestionIndex++;
            this.resetTranscriptState();

            this.askQuestion();
        } catch (error) {
            console.error('Could not generate the next question; using local fallback:', error);
            const stage = this.plannedInterviewStage();
            this.appendGeneratedQuestion(this.localQuestionResult(this.localStageQuestion(stage), { stage }));
            this.state.interview.currentQuestionIndex++;
            this.resetTranscriptState();
            this.askQuestion();
        }
    },

    async startInterview() {
        const config = this.getInterviewConfig(this.state.wizard.length);
        this.state.interview = {
            length: config.length,
            mainTarget: config.mainTarget,
            maxQuestions: config.maxQuestions,
            maxFollowUps: config.maxFollowUps,
            mainQuestionsAsked: 0,
            followUpsAsked: 0,
            currentQuestionIndex: 0,
            questions: [],
            questionMeta: [],
            responses: [],
            skippedQuestions: [],
            clarificationRequests: [],
            coveredJobRequirements: [],
            startTime: new Date(),
            isListening: false,
            awaitingFollowUp: false,
            currentStage: 'opening',
            currentTopic: 'Introduction',
            currentQuestionReason: '',
            currentJobRequirement: '',
            previousQuestion: '',
            latestAnswer: '',
            transcript: [],
            askedQuestions: []
        };

        const statusEl = document.getElementById('interviewer-status');
        if (statusEl) statusEl.textContent = 'Starting interview...';

        if (typeof Logger !== 'undefined') {
            Logger.logInterviewStart(this.state.user, this.state.interviewMode, this.state.job.description);
        }

        try {
            const result = await this.requestInterviewQuestion();
            this.appendGeneratedQuestion(result);
        } catch (error) {
            console.error('Could not start the AI interview; using local opening question:', error);
            this.appendGeneratedQuestion(this.localQuestionResult(this.localStageQuestion('opening'), { stage: 'opening' }));
        }

        this.goToStage(4);
        this.resetTranscriptState();
        setTimeout(() => this.askQuestion(), 400);
    },
    async generateFinalReport() {
        const responses = this.state.interview.responses;

        const statusEl = document.getElementById('completion-status-text');
        if (statusEl) statusEl.textContent = 'Analyzing your performance...';

        try {
            const report = await this.postJSON('/api/final-report', {
                full_interview_transcript: responses,
                skipped_questions: this.state.interview.skippedQuestions,
                interview_type: this.state.interviewMode,
                interview_length: this.state.interview.length,
                job_description: this.state.job.description,
                student_profile: this.state.user
            });
            const reviews = report.question_reviews || [];
            const bestReview = reviews.reduce((best, review) => !best || review.score > best.score ? review : best, null);
            const weakestReview = reviews.reduce((worst, review) => !worst || review.score < worst.score ? review : worst, null);
            const aiReport = {
                score: report.overall_score,
                strengths: report.strengths?.length ? report.strengths : [report.top_strength],
                improvements: report.improvements?.length ? report.improvements : [report.main_improvement],
                actionPlan: report.action_plan,
                bestAnswer: bestReview ? bestReview.what_went_well : report.top_strength,
                weakestAnswer: weakestReview ? weakestReview.what_to_improve : report.main_improvement,
                starExample: weakestReview?.better_answer_example || '',
                questionReviews: reviews,
                dimensionScores: report.dimension_scores || {},
                technicalGaps: report.technical_gaps || [],
                requirementsCovered: report.job_requirements_covered || [],
                requirementsToPractice: report.job_requirements_to_practice || [],
                recommendedPracticeQuestions: report.recommended_practice_questions || [],
                skippedQuestions: this.state.interview.skippedQuestions || [],
                scoringSummary: report.scoring_summary || '',
                finalRecommendation: report.final_recommendation || ''
            };
            aiReport.date = new Date().toLocaleDateString();
            aiReport.interviewType = this.state.interviewMode;
            aiReport.summary = aiReport.scoringSummary || aiReport.finalRecommendation;

            this.renderReportView(aiReport);

            this.saveSession(aiReport);

            if (typeof Logger !== 'undefined') {
                const totalDuration = Math.round((new Date() - this.state.interview.startTime) / 1000);
                Logger.logInterviewComplete(aiReport, aiReport.improvements?.join(', '), totalDuration);
            }

            // Show continue button on completion screen
            if (statusEl) statusEl.textContent = 'Analysis Complete!';
            const continueBtn = document.getElementById('btn-continue-report');
            if (continueBtn) continueBtn.classList.remove('hidden');

        } catch (e) {
            console.error("Failed to generate AI report:", e);
            if (statusEl) statusEl.textContent = `Analysis failed: ${e.message}`;
        }

        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    renderReportView(report) {
        const el = (id) => document.getElementById(id);
        const splitIntoBullets = (value) => {
            const source = Array.isArray(value) ? value : [value];
            const parts = source
                .flatMap((item) => String(item || '').split(/\n+|(?:\.\s+)|(?:;\s+)|(?:,\s+(?=[A-Z]))/))
                .map((part) => part.trim())
                .filter(Boolean);
            return parts.slice(0, 3);
        };
        const renderBulletList = (targetId, value, emptyText) => {
            const node = el(targetId);
            if (!node) return;
            const items = splitIntoBullets(value);
            node.innerHTML = items.length
                ? items.map((item) => `<li>${this.escapeHTML(item)}</li>`).join('')
                : `<li>${this.escapeHTML(emptyText)}</li>`;
        };
        if (el('rep-score')) el('rep-score').textContent = report.score;
        if (el('rep-score-label')) {
            const s = Number(report.score) || 0;
            el('rep-score-label').textContent = report.scoreLabel || (s === 0 ? 'Not enough evidence' : (s >= 9 ? 'Excellent' : (s >= 7 ? 'Good' : (s >= 5 ? 'Needs Practice' : 'Beginner'))));
        }
        if (el('rep-type')) el('rep-type').textContent = report.interviewType || 'Interview';
        if (el('rep-date')) el('rep-date').textContent = report.date || '';
        if (el('rep-summary')) {
            const summary = String(report.summary || report.finalRecommendation || 'A clear summary of how you performed, what matters most, and what to practice next.').trim();
            const firstLine = summary.split(/(?<=[.!?])\s+/)[0];
            el('rep-summary').textContent = firstLine.length > 180 ? `${firstLine.slice(0, 177).trim()}…` : firstLine;
        }
        renderBulletList('rep-top-strength', report.strengths?.length ? report.strengths : [report.top_strength], 'No clear strength yet.');
        renderBulletList('rep-main-improvement', report.improvements?.length ? report.improvements : [report.main_improvement], 'No clear improvement area yet.');
        renderBulletList('rep-next-practice', report.recommended_practice_questions?.length ? report.recommended_practice_questions : report.actionPlan, 'Practice the weakest answer again with more detail.');

        const actionPlan = el('rep-action-plan');
        if (actionPlan) {
            actionPlan.innerHTML = (report.actionPlan || report.improvements || []).slice(0, 3).map((item) => `
                <li class="flex gap-2 items-start">
                    <i data-lucide="arrow-right-circle" class="w-4 h-4 text-brand-500 mt-0.5 shrink-0"></i>
                    <span>${this.escapeHTML(item)}</span>
                </li>
            `).join('') || '<li class="text-slate-400">No action plan available yet.</li>';
        }

        const qReviewContainer = el('rep-q-review');
        if (qReviewContainer) {
            const reviews = report.questionReviews || [];
            qReviewContainer.innerHTML = reviews.length ? reviews.map((review, i) => `
                <article class="report-question-card space-y-4">
                    <div class="flex items-start justify-between gap-4">
                        <div class="space-y-2">
                            <p class="text-xs font-bold text-brand-600">Question ${i + 1}</p>
                            <p class="text-[15px] font-bold text-slate-900 leading-relaxed">${this.escapeHTML(review.question)}</p>
                        </div>
                        <span class="report-score-chip shrink-0">${this.escapeHTML(review.score)}/10</span>
                    </div>
                    <div>
                        <p class="text-xs font-bold text-slate-500 mb-2">Your answer</p>
                        <div class="bg-slate-50 p-3.5 rounded-xl border border-slate-100 text-sm text-slate-700 leading-relaxed">
                            ${this.escapeHTML(review.answer)}
                        </div>
                    </div>
                    <div class="grid md:grid-cols-2 gap-3 text-sm">
                        <div class="report-feedback-soft report-feedback-soft--positive">
                            <p class="text-xs font-bold text-emerald-700 mb-2">What went well</p>
                            <ul class="space-y-2 text-slate-700">
                                ${(splitIntoBullets(review.what_went_well).length ? splitIntoBullets(review.what_went_well) : ['No clear strength was demonstrated yet.']).map((item) => `<li class="flex gap-2"><span class="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0"></span><span>${this.escapeHTML(item)}</span></li>`).join('')}
                            </ul>
                        </div>
                        <div class="report-feedback-soft report-feedback-soft--improve">
                            <p class="text-xs font-bold text-orange-700 mb-2">What to improve</p>
                            <ul class="space-y-2 text-slate-700">
                                ${(splitIntoBullets(review.what_to_improve).length ? splitIntoBullets(review.what_to_improve) : ['Add a clearer example and outcome.']).map((item) => `<li class="flex gap-2"><span class="mt-1 h-1.5 w-1.5 rounded-full bg-orange-500 shrink-0"></span><span>${this.escapeHTML(item)}</span></li>`).join('')}
                            </ul>
                        </div>
                    </div>
                    <details class="rounded-xl border border-indigo-100 bg-indigo-50/55 p-4">
                        <summary class="report-answer-toggle cursor-pointer list-none text-sm font-semibold text-brand-700">
                            <span>Better answer</span>
                            <i data-lucide="chevron-down" class="report-chevron w-4 h-4 shrink-0 transition-transform"></i>
                        </summary>
                        <p class="mt-3 text-sm text-slate-700 leading-relaxed">${this.escapeHTML(review.better_answer_example)}</p>
                    </details>
                </article>
            `).join('') : '<div class="text-sm text-slate-500">No answered questions were available to review.</div>';
        }

        this.renderReportDetails(report);
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    renderReportDetails(report) {
        const renderList = (id, items, emptyText) => {
            const container = document.getElementById(id);
            if (!container) return;
            container.innerHTML = (items || []).length
                ? items.map((item) => `<li class="flex gap-2"><i data-lucide="check-circle-2" class="w-4 h-4 text-brand-500 mt-0.5 shrink-0"></i><span>${this.escapeHTML(item)}</span></li>`).join('')
                : `<li class="text-slate-400">${emptyText}</li>`;
        };
        renderList('rep-requirements-covered', report.requirementsCovered, 'No requirement had enough evidence yet.');
        renderList('rep-requirements-practice', report.requirementsToPractice, 'No additional requirement was identified.');
        const skipped = document.getElementById('rep-skipped-questions');
        if (skipped) skipped.innerHTML = (report.skippedQuestions || []).length
            ? report.skippedQuestions.map((item, index) => `<div class="p-3 bg-slate-50 border border-slate-100 rounded-xl"><p class="text-xs font-bold text-slate-400 mb-1">Skipped ${index + 1} · ${this.escapeHTML(this.interviewStageLabel(item.stage))}</p><p>${this.escapeHTML(item.question)}</p></div>`).join('')
            : '<p class="text-slate-400">No questions were skipped.</p>';
    },

    handleReportContinue() {
        this.showInsights();
    },

    showInsights() {
        const el = (id) => document.getElementById(id);
        const name = this.state.user.name || 'User';
        const firstName = name.split(' ')[0];

        if (el('insights-user-name')) el('insights-user-name').textContent = `${firstName}'s AI Insights`;
        
        // Populate random/mock market value for fun
        if (el('insights-market-value')) {
            const baseValue = 85000;
            const extra = this.state.sessions.length * 1500;
            const value = baseValue + extra;
            el('insights-market-value').textContent = `$${value.toLocaleString()}`;
        }

        this.goToStage(8);
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    saveSession(aiReport) {
        this.state.sessions.unshift({
            date: new Date().toLocaleDateString(),
            mode: this.state.interviewMode,
            score: aiReport.score,
            field: this.state.user.field,
            strengths: aiReport.strengths || [],
            weaknesses: aiReport.improvements || [],
            actionPlan: aiReport.actionPlan || [],
            bestAnswer: aiReport.bestAnswer || '',
            weakestAnswer: aiReport.weakestAnswer || '',
            starExample: aiReport.starExample || '',
            questionReviews: aiReport.questionReviews || [],
            dimensionScores: aiReport.dimensionScores || {},
            technicalGaps: aiReport.technicalGaps || [],
            requirementsCovered: aiReport.requirementsCovered || [],
            requirementsToPractice: aiReport.requirementsToPractice || [],
            recommendedPracticeQuestions: aiReport.recommendedPracticeQuestions || [],
            skippedQuestions: aiReport.skippedQuestions || [],
            interviewLength: this.state.interview.length,
            scoringSummary: aiReport.scoringSummary || '',
            finalRecommendation: aiReport.finalRecommendation || '',
            responses: JSON.parse(JSON.stringify(this.state.interview.responses))
        });
        this.saveUserData();
    },

    // --- Practice ---
    async startPractice() {
        const el = (id) => document.getElementById(id);
        const latestSession = this.state.sessions[0];
        const weakness = (latestSession && latestSession.weaknesses && latestSession.weaknesses.length > 0) 
                         ? latestSession.weaknesses[0] 
                         : "General Communication";

        this.state.currentPracticeWeakness = weakness;

        // Reset UI
        if (el('practice-weakness-name')) el('practice-weakness-name').textContent = weakness;
        if (el('practice-answer-input')) el('practice-answer-input').value = '';
        if (el('practice-feedback-container')) el('practice-feedback-container').classList.add('hidden');
        if (el('practice-container')) el('practice-container').classList.add('hidden');
        if (el('practice-loading')) el('practice-loading').classList.remove('hidden');

        this.goToStage(7);

        try {
            const prompt = `
                The student wants to practice their weakest area: "${weakness}".
                Based on this area, generate ONE specific, challenging interview question that would help them improve.
                
                Respond with ONLY the question text.
            `;
            
            const question = await this.callModelAPI(prompt, "You are an expert career coach helping a student improve a specific interview weakness.");
            
            if (el('practice-question')) el('practice-question').textContent = question || `How do you specifically handle challenges related to ${weakness}?`;
            
            if (el('practice-loading')) el('practice-loading').classList.add('hidden');
            if (el('practice-container')) el('practice-container').classList.remove('hidden');
        } catch (err) {
            console.error("Failed to generate practice question:", err);
            if (el('practice-question')) el('practice-question').textContent = `Can you give me an example of how you've demonstrated strong ${weakness} in the past?`;
            if (el('practice-loading')) el('practice-loading').classList.add('hidden');
            if (el('practice-container')) el('practice-container').classList.remove('hidden');
        }
        
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    async submitPracticeAnswer() {
        const el = (id) => document.getElementById(id);
        const answer = el('practice-answer-input')?.value.trim();
        if (!answer || answer.length < 5) return alert("Please type a more detailed response.");

        const btn = el('btn-submit-practice');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Analyzing...';
        }

        try {
            const prompt = `
                The student is practicing their growth area: "${this.state.currentPracticeWeakness}".
                
                QUESTION ASKED: ${el('practice-question').textContent}
                STUDENT ANSWER: ${answer}
                
                Provide a brief, encouraging, and highly actionable evaluation of this answer. 
                Point out one thing they did well and one specific thing they could still improve.
                Keep it under 100 words.
            `;
            
            const feedback = await this.callModelAPI(prompt, "You are an expert career coach providing instant feedback on a practice answer.");
            
            if (el('practice-feedback-text')) el('practice-feedback-text').innerHTML = `<p>${feedback.replace(/\n/g, '<br>')}</p>`;
            if (el('practice-feedback-container')) el('practice-feedback-container').classList.remove('hidden');
            
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        } catch (err) {
            console.error("Failed to analyze practice answer:", err);
            alert("Connection error. Please try again.");
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = 'Analyze Performance <i data-lucide="sparkles" class="w-4 h-4 group-hover:rotate-12 transition-transform"></i>';
            }
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    },

    openLatestReport() {
        if (this.state.sessions.length > 0) {
            this.loadSessionReport(0);
        }
    },

    loadSessionReport(index) {
        const s = this.state.sessions[index];
        if (!s) return;
        
        // Switch to report stage
        this.goToStage(6);
        this.renderReportView({
            score: s.score,
            top_strength: s.strengths?.[0] || 'No clear strength yet.',
            main_improvement: s.weaknesses?.[0] || 'No clear improvement area yet.',
            recommended_practice_questions: s.recommendedPracticeQuestions || [],
            actionPlan: s.actionPlan || s.weaknesses || [],
            questionReviews: s.questionReviews || [],
            requirementsCovered: s.requirementsCovered || [],
            requirementsToPractice: s.requirementsToPractice || [],
            skippedQuestions: s.skippedQuestions || [],
            interviewType: s.mode || 'Interview',
            date: s.date || '',
            summary: s.scoringSummary || s.finalRecommendation || '',
            finalRecommendation: s.finalRecommendation || '',
            scoreLabel: s.score === 0 ? 'Not enough evidence' : (s.score >= 9 ? 'Excellent' : (s.score >= 7 ? 'Good' : (s.score >= 5 ? 'Needs Practice' : 'Beginner')))
        });
    },

    // --- Dashboard ---
    formatDashboardName(name) {
        const first = String(name || 'Guest').trim().split(/\s+/)[0] || 'Guest';
        if (first.toLowerCase() === 'guest') return 'Guest';
        if (first === first.toUpperCase() || first === first.toLowerCase()) {
            return first.charAt(0).toLocaleUpperCase() + first.slice(1).toLocaleLowerCase();
        }
        return first;
    },

    toggleDashboardCard(button) {
        const container = document.getElementById(button.dataset.dashboardExpand);
        if (!container) return;
        const expanded = container.classList.toggle('is-expanded');
        button.textContent = expanded ? 'Show less' : 'Show more';
        if (!expanded) requestAnimationFrame(() => this.refreshDashboardExpanders());
    },

    refreshDashboardExpanders() {
        document.querySelectorAll('[data-dashboard-expand]').forEach((button) => {
            const container = document.getElementById(button.dataset.dashboardExpand);
            if (!container) return;
            if (container.classList.contains('is-expanded')) {
                button.classList.remove('hidden');
                return;
            }
            const textBlocks = container.querySelectorAll('.dashboard-clamp-title, .dashboard-clamp-copy');
            const truncated = Array.from(textBlocks).some((block) => block.scrollHeight > block.clientHeight + 1);
            button.classList.toggle('hidden', !truncated);
            button.textContent = 'Show more';
        });
    },

    _updateDashboardUI() {
        const el = (id) => document.getElementById(id);
        const name = this.state.user.name || 'Guest';
        const firstName = this.formatDashboardName(name);

        if (el('dash-welcome-name')) el('dash-welcome-name').textContent = firstName;
        if (el('nav-user-avatar')) el('nav-user-avatar').textContent = name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);

        // Profile Completeness
        let pct = 0;
        let missing = [];
        if (this.state.user.name) pct += 20; else missing.push('Name');
        if (this.state.user.field) pct += 20;
        if (this.state.user.skills) pct += 20; else missing.push('Skills');
        if (this.state.user.courses) pct += 20;
        if (this.state.user.experience) pct += 20; else missing.push('Projects');
        
        if (el('dash-profile-pct')) el('dash-profile-pct').textContent = `${pct}%`;
        if (el('dash-profile-bar')) el('dash-profile-bar').style.width = `${pct}%`;
        
        if (el('dash-profile-missing')) {
            if (missing.length === 0) {
                el('dash-profile-missing').innerHTML = `<li class="flex items-center gap-2 text-green-600 font-bold uppercase text-[9px] tracking-widest"><i data-lucide="check-circle" class="w-3.5 h-3.5"></i> Profile Complete</li>`;
            } else {
                el('dash-profile-missing').innerHTML = missing.map(m => `<li class="flex items-center gap-2 text-slate-400 font-bold uppercase text-[9px] tracking-widest"><i data-lucide="x-circle" class="w-3.5 h-3.5"></i> ${m}</li>`).join('');
            }
        }

        // Readiness Score Card
        const hasInterviews = this.state.sessions.length > 0;
        if (el('dash-welcome-copy')) {
            el('dash-welcome-copy').textContent = hasInterviews
                ? 'Your latest feedback is ready. Continue with the recommendation below or revisit a previous report.'
                : (pct >= 60
                    ? 'Your profile has enough context. Build a focused practice session when you are ready.'
                    : 'Start with your profile so the interviewer can ask questions that fit your background and goals.');
        }
        if (!hasInterviews) {
            if (el('dash-readiness-score')) el('dash-readiness-score').textContent = "--";
            if (el('dash-readiness-score')) el('dash-readiness-score').className = "text-6xl font-black text-slate-200 tracking-tighter";
            if (el('dash-readiness-desc')) el('dash-readiness-desc').textContent = "Complete an interview to unlock your score.";
            if (el('dash-score-btn')) el('dash-score-btn').textContent = "Start interview";
        } else {
            const avgScore = Math.round(this.state.sessions.slice(0, 3).reduce((acc, s) => acc + s.score, 0) / Math.min(this.state.sessions.length, 3) * 10);
            if (el('dash-readiness-score')) {
                el('dash-readiness-score').textContent = avgScore;
                el('dash-readiness-score').className = "text-6xl font-black text-brand-600 tracking-tighter";
            }
            if (el('dash-readiness-desc')) el('dash-readiness-desc').textContent = `Based on your last ${Math.min(this.state.sessions.length, 3)} sessions.`;
            if (el('dash-score-btn')) el('dash-score-btn').textContent = "View reports";
        }

        // Focus Area Card
        if (!hasInterviews) {
            if (el('dash-focus-area-title')) el('dash-focus-area-title').textContent = "What to practice next";
            if (el('dash-focus-area-desc')) el('dash-focus-area-desc').textContent = "After one interview, this will show the single skill to focus on next.";
            if (el('dash-focus-btn')) el('dash-focus-btn').textContent = "Practice this area";
        } else {
            const latest = this.state.sessions[0];
            if (latest.weaknesses && latest.weaknesses.length > 0) {
                if (el('dash-focus-area-title')) el('dash-focus-area-title').textContent = latest.weaknesses[0];
                if (el('dash-focus-area-desc')) el('dash-focus-area-desc').textContent = "This is the main thing to improve before your next session.";
                if (el('dash-focus-btn')) el('dash-focus-btn').textContent = "Practice this area";
            }
        }

        // Recommended Next Session Card
        if (!hasInterviews) {
            const profileReady = Boolean(this.state.user.name && this.state.user.skills && (this.state.user.experience || this.state.user.cvData?.education?.length));
            if (el('dash-session-suggestion-title')) el('dash-session-suggestion-title').textContent = profileReady ? 'Start an interview' : 'Complete your profile';
            if (el('dash-session-suggestion-desc')) el('dash-session-suggestion-desc').textContent = profileReady ? 'Choose a short or full adaptive session tailored to your goal.' : 'Add your background first so the interviewer can ask relevant questions.';
            if (el('dash-suggestion-btn')) {
                el('dash-suggestion-btn').textContent = profileReady ? 'Set up interview' : 'Continue profile';
                el('dash-suggestion-btn').onclick = () => profileReady ? this.goToStage(3) : this.openEditProfile();
            }
        } else {
            const latest = this.state.sessions[0];
            let nextMode = 'technical';
            let recommendation = 'Technical Round';
            let reason = 'Based on your field, a technical deep-dive is recommended.';
            
            if (latest.mode === 'technical') {
                nextMode = 'hr';
                recommendation = 'Behavioral Round';
                reason = 'You recently did a technical round. Let\'s polish your behavioral answers.';
            } else if (latest.mode === 'hr') {
                nextMode = 'behavioral';
                recommendation = 'Behavioral Round';
                reason = 'Build stronger evidence-based examples from your projects and experience.';
            }

            if (el('dash-session-suggestion-title')) el('dash-session-suggestion-title').textContent = "Start an Interview";
            if (el('dash-session-suggestion-desc')) el('dash-session-suggestion-desc').textContent = `Recommended: ${recommendation}. ${reason}`;
            if (el('dash-suggestion-btn')) el('dash-suggestion-btn').textContent = "Start session";
            if (el('dash-suggestion-btn')) el('dash-suggestion-btn').onclick = () => {
                this.state.wizard.style = nextMode;
                this.goToStage(3);
            };
        }

        // Recent Interview
        if (hasInterviews) {
            const latest = this.state.sessions[0];
            if (el('dash-recent-interview')) el('dash-recent-interview').classList.remove('hidden');
            if (el('dash-recent-interview')) el('dash-recent-interview').classList.add('flex');
            if (el('dash-no-recent')) el('dash-no-recent').classList.add('hidden');
            
            if (el('dash-recent-type')) el('dash-recent-type').textContent = latest.mode;
            if (el('dash-recent-date')) el('dash-recent-date').textContent = latest.date;
            if (el('dash-recent-job')) el('dash-recent-job').textContent = latest.field;
            if (el('dash-recent-score')) el('dash-recent-score').textContent = `${latest.score}/10`;
        } else {
            if (el('dash-recent-interview')) {
                el('dash-recent-interview').classList.add('hidden');
                el('dash-recent-interview').classList.remove('flex');
            }
            if (el('dash-no-recent')) el('dash-no-recent').classList.remove('hidden');
        }

        requestAnimationFrame(() => this.refreshDashboardExpanders());
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    // --- History ---
    showHistory() {
        const list = document.getElementById('history-list');
        if (!list) return;

        if (this.state.sessions.length > 0) {
            list.innerHTML = this.state.sessions.map((s, i) => `
                <div class="group p-6 bg-white rounded-3xl shadow-soft border border-slate-100 hover:border-brand-200 transition-all cursor-default relative">
                    <button onclick="window.app.deleteSession(${i})" class="absolute top-4 right-4 w-8 h-8 bg-white border border-slate-100 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all" title="Delete Session">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                    <div class="flex items-center justify-between mb-4 mr-6">
                        <div class="flex items-center gap-4">
                            <div class="w-12 h-12 bg-brand-50 text-brand-600 rounded-2xl flex items-center justify-center shrink-0">
                                <i data-lucide="message-square" class="w-6 h-6"></i>
                            </div>
                            <div>
                                <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">${s.date} &bull; ${s.mode}</p>
                                <p class="text-base font-black text-brand-900">${s.field}</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-6">
                            <div class="text-right">
                                <p class="text-2xl font-black text-brand-500">${s.score}<span class="text-sm opacity-40">/10</span></p>
                                <p class="text-[9px] font-black text-slate-300 uppercase tracking-widest">Score</p>
                            </div>
                            <button onclick="window.app.loadSessionReport(${i})" class="btn-primary py-2.5 px-6 text-[10px] uppercase tracking-widest rounded-xl shadow-lg">View Report</button>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-6 border-t border-slate-50 pt-6">
                        <div>
                            <p class="text-[9px] font-bold text-green-600 uppercase tracking-[0.2em] mb-2 flex items-center gap-1"><i data-lucide="arrow-up-circle" class="w-3 h-3"></i> Top Strength</p>
                            <p class="text-xs text-slate-500 font-medium">${s.strengths && s.strengths.length > 0 ? s.strengths[0] : 'N/A'}</p>
                        </div>
                        <div>
                            <p class="text-[9px] font-bold text-orange-500 uppercase tracking-[0.2em] mb-2 flex items-center gap-1"><i data-lucide="alert-triangle" class="w-3 h-3"></i> Top Focus Area</p>
                            <p class="text-xs text-slate-500 font-medium">${s.weaknesses && s.weaknesses.length > 0 ? s.weaknesses[0] : 'N/A'}</p>
                        </div>
                    </div>
                </div>
            `).join('');
        } else {
            list.innerHTML = `
                <div class="p-8 text-center bg-slate-50 rounded-2xl border border-slate-100">
                    <i data-lucide="ghost" class="w-12 h-12 text-slate-300 mx-auto mb-3"></i>
                    <p class="text-slate-500 font-medium">No interviews completed yet.</p>
                </div>
            `;
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    deleteSession(index) {
        if (!confirm("Are you sure you want to delete this session? This action cannot be undone.")) return;
        
        this.state.sessions.splice(index, 1);
        this.saveUserData();
        this.showHistory();
        
        // Show a brief status message if possible
        const statusEl = document.getElementById('history-status');
        if (statusEl) {
            statusEl.textContent = 'Session deleted.';
            statusEl.classList.remove('hidden');
            setTimeout(() => statusEl.classList.add('hidden'), 3000);
        }
    },

    // --- Live Speech Transcription ---
    initSpeech() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { this.recognition = null; return; }

        this.recognition = new SR();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        this.recognition.onresult = (e) => {
            let newFinal = '';
            let interim = '';
            for (let i = e.resultIndex; i < e.results.length; ++i) {
                if (e.results[i].isFinal) {
                    newFinal += e.results[i][0].transcript + ' ';
                } else {
                    interim += e.results[i][0].transcript;
                }
            }
            if (newFinal) this.state.transcriptState.final += newFinal;
            this.state.transcriptState.interim = interim;
            this.updateTranscriptDisplay();
        };

        this.recognition.onerror = (e) => {
            if (e.error === 'not-allowed' || e.error === 'permission-denied') {
                this.setMicState('denied');
                this.showFallbackInput();
            } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
                this.setMicState('error');
            }
        };

        // Auto-restart if recognition ends unexpectedly while still supposed to listen
        this.recognition.onend = () => {
            if (this.state.interview.isListening) {
                try { this.recognition.start(); } catch(err) {}
            }
        };
    },

    updateTranscriptDisplay() {
        const editArea = document.getElementById('int-answer-area');

        const hasFinal = !!this.state.transcriptState.final;
        const hasInterim = !!this.state.transcriptState.interim;

        if (editArea && (hasFinal || hasInterim)) {
            editArea.value = this.state.transcriptState.final + this.state.transcriptState.interim;
            editArea.scrollTop = editArea.scrollHeight;
            this.updateAnswerState();
        }
    },

    setMicState(state) {
        const dot = document.getElementById('mic-state-dot');
        const label = document.getElementById('mic-state-label');
        const wave = document.getElementById('mic-wave');
        const micBtn = document.getElementById('int-mic-btn');
        const micLabel = document.getElementById('int-mic-label');
        const statusEl = document.getElementById('interviewer-status');

        const cfg = {
            idle:       { btnCls: 'bg-white text-slate-600 border-slate-200',   btnLabel: 'Dictate',      status: 'Your turn — type or dictate your response' },
            listening:  { btnCls: 'bg-red-50 text-red-600 border-red-200',       btnLabel: 'Listening...',       status: 'Listening...' },
            processing: { btnCls: 'bg-white text-slate-400 border-slate-100',    btnLabel: 'Dictate',      status: 'Processing...' },
            done:       { btnCls: 'bg-white text-slate-600 border-slate-200',    btnLabel: 'Dictate',  status: 'Response captured' },
            denied:     { btnCls: 'bg-orange-50 text-orange-600 border-orange-200',  btnLabel: 'Mic Denied', status: 'Microphone unavailable — type below' },
            error:      { btnCls: 'bg-orange-50 text-orange-600 border-orange-200',  btnLabel: 'Error - Retry',      status: 'Recognition error' }
        };

        const s = cfg[state] || cfg.idle;
        if (micBtn) {
            micBtn.className = `flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 text-sm rounded-lg border-2 transition-colors ${s.btnCls}`;
        }
        if (micLabel) micLabel.textContent = s.btnLabel;
        if (statusEl) statusEl.textContent = s.status;
    },

    resetTranscriptState() {
        this.state.transcriptState = { final: '', interim: '', isEditing: false };

        const editArea = document.getElementById('int-answer-area');
        if (editArea) { editArea.value = ''; }
    },

    getTranscribedAnswer() {
        const editArea = document.getElementById('int-answer-area');
        return editArea ? editArea.value.trim() : '';
    },

    toggleListening() {
        this.state.interview.isListening ? this.stopListening() : this.startListening();
    },

    startListening() {
        if (!this.recognition) {
            this.showFallbackInput();
            return;
        }
        this.state.interview.isListening = true;
        try { this.recognition.start(); } catch(e) {}
        this.setMicState('listening');
        const actions = document.getElementById('transcript-actions');
        if (actions) actions.classList.add('hidden');
    },

    stopListening() {
        this.state.interview.isListening = false;
        if (this.recognition) { try { this.recognition.stop(); } catch(e) {} }

        this.state.transcriptState.interim = '';
        this.updateTranscriptDisplay();

        if (this.state.transcriptState.final.trim()) {
            this.setMicState('done');
            const actions = document.getElementById('transcript-actions');
            if (actions) actions.classList.remove('hidden');
        } else {
            this.setMicState('idle');
        }
    },

    reRecord() {
        this.stopListening();
        this.resetTranscriptState();
        this.setMicState('idle');
        setTimeout(() => this.startListening(), 200);
    },

    toggleTranscriptEdit() {
        const el = (id) => document.getElementById(id);
        this.state.transcriptState.isEditing = !this.state.transcriptState.isEditing;

        if (this.state.transcriptState.isEditing) {
            const editArea = el('transcript-edit-area');
            if (editArea) { editArea.value = this.state.transcriptState.final.trim(); editArea.classList.remove('hidden'); }
            if (el('transcript-live')) el('transcript-live').classList.add('hidden');
            if (el('edit-transcript-btn')) el('edit-transcript-btn').innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i> Done';
        } else {
            const editArea = el('transcript-edit-area');
            if (editArea) { this.state.transcriptState.final = editArea.value; editArea.classList.add('hidden'); }
            if (el('transcript-live')) el('transcript-live').classList.remove('hidden');
            if (el('edit-transcript-btn')) el('edit-transcript-btn').innerHTML = '<i data-lucide="pencil" class="w-3.5 h-3.5"></i> Edit';
            this.updateTranscriptDisplay();
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    showFallbackInput() {
        this.setMicState('denied');
        this.state.transcriptState.isEditing = true;
        const editArea = document.getElementById('transcript-edit-area');
        const liveDiv = document.getElementById('transcript-live');
        const placeholder = document.getElementById('transcript-placeholder');
        const actions = document.getElementById('transcript-actions');
        if (editArea) { editArea.classList.remove('hidden'); editArea.focus(); }
        if (liveDiv) liveDiv.classList.add('hidden');
        if (placeholder) placeholder.classList.add('hidden');
        if (actions) actions.classList.remove('hidden');
    },

    // --- Speech Synthesis ---
    speak(text, callback, rate = 0.94) {
        if (!window.speechSynthesis) { if (callback) callback(); return; }
        window.speechSynthesis.cancel();
        const ut = new SpeechSynthesisUtterance(text);
        const voices = window.speechSynthesis.getVoices();
        ut.voice = voices.find(v => v.name.includes('Samantha') || v.name.includes('Google US English') || v.lang.startsWith('en-US')) || voices[0];
        ut.rate = rate; ut.pitch = 1.0;
        const pulseEl = document.getElementById('ai-pulse');
        const statusEl = document.getElementById('interviewer-status');
        ut.onstart = () => { if (pulseEl) pulseEl.classList.add('opacity-100'); if (statusEl) statusEl.textContent = 'Speaking...'; };
        ut.onend = () => { if (pulseEl) pulseEl.classList.remove('opacity-100'); if (callback) callback(); };
        window.speechSynthesis.speak(ut);
    }
};

document.addEventListener('DOMContentLoaded', () => window.app.init());
