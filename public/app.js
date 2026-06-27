const STAGE_HASHES = ['', '#dashboard', '#profile', '#setup', '#interview', '#completion', '#report', '#practice', '#history'];
const HASH_TO_STAGE = Object.fromEntries(STAGE_HASHES.map((h, i) => [h, i]).filter(([h]) => h));

window.app = {
    supabase: null,
    supabaseConfig: null,
    supabaseAuthSubscription: null,

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

    readJSON(key, fallback) {
        try {
            return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
        } catch (error) {
            console.warn(`[PrepWise Auth] Could not read ${key}:`, error.message);
            return fallback;
        }
    },

    async loadRuntimeConfig() {
        const existing = window.PREPWISE_CONFIG || {};
        try {
            const response = await fetch('/api/config', { cache: 'no-store' });
            if (response.ok) {
                const serverConfig = await response.json();
                window.PREPWISE_CONFIG = { ...existing, ...serverConfig };
            } else {
                window.PREPWISE_CONFIG = existing;
                console.warn(`[PrepWise Auth] Runtime config request failed (${response.status}). Google login will stay disabled.`);
            }
        } catch (error) {
            window.PREPWISE_CONFIG = existing;
            console.warn('[PrepWise Auth] Runtime config request failed. Google login will stay disabled.', error.message);
        }
        return window.PREPWISE_CONFIG;
    },

    getSupabaseConfig(config = window.PREPWISE_CONFIG || {}) {
        return {
            url: config.supabaseUrl || config.SUPABASE_URL || '',
            anonKey: config.supabaseAnonKey || config.SUPABASE_ANON_KEY || ''
        };
    },

    async initSupabaseClient() {
        const config = await this.loadRuntimeConfig();
        const { url, anonKey } = this.getSupabaseConfig(config);
        this.supabaseConfig = { url, anonKey };

        if (!url || !anonKey) {
            console.warn('[PrepWise Auth] Supabase URL or anon key is missing. Local and guest auth remain available.');
            return null;
        }

        if (!window.supabase || typeof window.supabase.createClient !== 'function') {
            console.warn('[PrepWise Auth] Supabase client library did not load. Local and guest auth remain available.');
            return null;
        }

        this.supabase = window.supabase.createClient(url, anonKey);
        return this.supabase;
    },

    watchSupabaseAuthState() {
        if (!this.supabase || this.supabaseAuthSubscription) return;
        const { data } = this.supabase.auth.onAuthStateChange(async (event, session) => {
            if (event === 'INITIAL_SESSION') return;
            if (session && ['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
                await this.applySupabaseSession(session);
                return;
            }
            if (event === 'SIGNED_OUT' && this.state.currentUser?.provider === 'supabase') {
                localStorage.removeItem('prepwise_session_v3');
                this.state.currentUser = null;
                this.state.supabaseSession = null;
                this.state.isGuest = false;
                this.goToStage(0);
            }
        });
        this.supabaseAuthSubscription = data?.subscription || null;
    },

    async getSupabaseSession() {
        if (!this.supabase) return null;
        try {
            const { data, error } = await this.supabase.auth.getSession();
            if (error) {
                console.warn('[PrepWise Auth] Could not read Supabase session:', error.message);
                return null;
            }
            return data?.session || null;
        } catch (error) {
            console.warn('[PrepWise Auth] Could not read Supabase session:', error.message);
            return null;
        }
    },

    hasMeaningfulProfile(profile) {
        if (!profile || typeof profile !== 'object') return false;
        return [
            'name', 'email', 'targetRole', 'location', 'summary', 'skills', 'courses',
            'projects', 'experience', 'linkedin', 'phone', 'certifications', 'languages'
        ].some((key) => Boolean(String(profile[key] || '').trim())) || Boolean(profile.cvData);
    },

    getStoredProfileForEmail(email) {
        const session = this.readJSON('prepwise_session_v3', null);
        if (session?.email === email && this.hasMeaningfulProfile(session.profile)) return session.profile;

        const users = this.readJSON('prepwise_users_v3', {});
        if (this.hasMeaningfulProfile(users[email]?.profile)) return users[email].profile;

        return this.hasMeaningfulProfile(this.state.user) ? this.state.user : null;
    },

    getStoredSessionsForEmail(email) {
        const session = this.readJSON('prepwise_session_v3', null);
        if (session?.email === email && Array.isArray(session.sessions)) return session.sessions;

        const users = this.readJSON('prepwise_users_v3', {});
        if (Array.isArray(users[email]?.sessions)) return users[email].sessions;

        return [];
    },

    async loadSupabaseProfileRow(userId) {
        if (!this.supabase || !userId) return null;
        try {
            const { data, error } = await this.supabase
                .from('profiles')
                .select('*')
                .eq('user_id', userId)
                .maybeSingle();
            if (error) {
                console.warn('[PrepWise Auth] Could not load Supabase profile row:', error.message);
                return null;
            }
            return data || null;
        } catch (error) {
            console.warn('[PrepWise Auth] Could not load Supabase profile row:', error.message);
            return null;
        }
    },

    buildSupabaseProfilePayload(session, existingRow = null) {
        const user = session?.user;
        if (!user?.id || !user?.email) return null;

        const metadata = user.user_metadata || {};
        const googleDisplayName = metadata.full_name || metadata.name || null;
        const currentProfile = this.hasMeaningfulProfile(this.state.user) ? this.state.user : null;
        const preservedProfile = currentProfile || existingRow?.raw_profile || {};
        const profile = { ...preservedProfile, email: user.email };
        if (!profile.name && googleDisplayName) profile.name = googleDisplayName;

        const cvData = profile.cvData ? this.normalizeCVData(profile.cvData) : null;
        const education = Array.isArray(cvData?.education) ? cvData.education : [];

        return {
            user_id: user.id,
            email: user.email,
            google_display_name: googleDisplayName,
            name: profile.name || existingRow?.name || googleDisplayName || null,
            field: profile.field || existingRow?.field || null,
            target_role: profile.targetRole || existingRow?.target_role || null,
            location: profile.location || existingRow?.location || null,
            summary: profile.summary || existingRow?.summary || null,
            skills_text: profile.skills || existingRow?.skills_text || null,
            courses_text: profile.courses || existingRow?.courses_text || null,
            projects_text: profile.projects || existingRow?.projects_text || null,
            experience_text: profile.experience || existingRow?.experience_text || null,
            certifications_text: profile.certifications || existingRow?.certifications_text || null,
            languages_text: profile.languages || existingRow?.languages_text || null,
            education,
            cv_data: cvData || existingRow?.cv_data || null,
            raw_profile: profile
        };
    },

    async upsertSupabaseProfile(session = this.state.supabaseSession, existingRow = null) {
        if (!this.supabase || !session?.user) return;
        const payload = this.buildSupabaseProfilePayload(session, existingRow);
        if (!payload) return;

        try {
            const { error } = await this.supabase
                .from('profiles')
                .upsert(payload, { onConflict: 'user_id' });
            if (error) {
                console.warn('[PrepWise Auth] Supabase profile upsert failed:', error.message);
            }
        } catch (error) {
            console.warn('[PrepWise Auth] Supabase profile upsert failed:', error.message);
        }
    },

    async applySupabaseSession(session) {
        const user = session?.user;
        if (!user?.id || !user?.email) return false;

        const existingRow = await this.loadSupabaseProfileRow(user.id);
        const metadata = user.user_metadata || {};
        const googleDisplayName = metadata.full_name || metadata.name || null;
        const storedProfile = this.getStoredProfileForEmail(user.email);
        const rowProfile = this.hasMeaningfulProfile(existingRow?.raw_profile) ? existingRow.raw_profile : null;
        const profile = {
            ...this.state.user,
            ...(rowProfile || {}),
            ...(storedProfile || {}),
            email: user.email
        };
        if (!profile.name && (existingRow?.name || googleDisplayName)) {
            profile.name = existingRow?.name || googleDisplayName;
        }

        const sessions = this.getStoredSessionsForEmail(user.email);
        this.state.supabaseSession = session;
        this.state.currentUser = {
            id: user.id,
            email: user.email,
            provider: 'supabase',
            profile,
            sessions,
            isGuest: false
        };
        this.state.user = profile;
        this.state.sessions = sessions;
        this.state.isGuest = false;

        this.saveUserData();
        await this.upsertSupabaseProfile(session, existingRow);
        this.updateUserUI();
        this.showDashboard();
        return true;
    },

    async signInWithGoogle() {
        if (!this.supabase) await this.initSupabaseClient();
        if (!this.supabase) {
            alert('Google login is not configured yet. You can still sign in locally or continue as guest.');
            return;
        }

        const { error } = await this.supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.origin }
        });
        if (error) {
            console.warn('[PrepWise Auth] Google sign-in failed:', error.message);
            alert('Google sign-in could not start. Please try local sign-in or guest mode.');
        }
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
        supabaseSession: null,
        wizard: { step: 1, goal: 'specific', jobDesc: '', style: 'hr', mood: 'professional', length: 'short', method: 'text' },
        user: {
            name: '', email: '', field: 'Software Engineering', targetRole: '', location: '', phone: '', summary: '',
            skills: '', courses: '', projects: '', experience: '', linkedin: '', certifications: '', languages: '', cvData: null
        },
        job: { description: '', link: '' },
        analysis: { matchScore: 0, difficulty: 'Moderate', strengths: [], gaps: [], topics: [] },
        practiceReturnStage: 1,
        pendingDeleteSessionIndex: null,
        isReadingQuestion: false,
        interviewMuted: false,
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
    async init() {
        this.cacheDOM();
        this.bindEvents();
        this.initSpeech();
        await this.initSupabaseClient();
        this.watchSupabaseAuthState();
        await this.checkAuth();
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
        window.addEventListener('scroll', () => this.updateProfileJumpState(), { passive: true });
        window.addEventListener('resize', () => this.updateProfileJumpState());
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
    async checkAuth() {
        const supabaseSession = await this.getSupabaseSession();
        if (supabaseSession) {
            const applied = await this.applySupabaseSession(supabaseSession);
            if (applied) return;
        }

        const session = localStorage.getItem('prepwise_session_v3');
        if (session) {
            try {
                const data = JSON.parse(session);
                this.state.currentUser = data;
                this.state.supabaseSession = null;
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
        const degreeTypes = ['High school', 'Diploma', 'Associate', 'Bachelor', 'Master', 'PhD', 'Bootcamp', 'Certification', 'Course', 'Other'];
        const currentType = String(education.field || '').trim();
        const typeOptions = [
            '<option value="">Choose type</option>',
            ...degreeTypes.map((type) => `<option value="${esc(type)}"${type === currentType ? ' selected' : ''}>${esc(type)}</option>`),
            currentType && !degreeTypes.includes(currentType) ? `<option value="${esc(currentType)}" selected>${esc(currentType)}</option>` : ''
        ].join('');
        const entry = document.createElement('div');
        entry.className = 'profile-education-item rounded-2xl border border-[#e6edf3] bg-[#fbfcfe] p-4 space-y-4';
        entry.innerHTML = `
            <div class="flex items-center justify-between">
                <p class="education-entry-title text-sm font-bold text-[#111827]">Education</p>
                <button type="button" onclick="window.app.removeEducationEntry(this)" class="profile-button-quiet !min-h-[34px] !px-2.5" aria-label="Remove education">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Remove
                </button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label class="profile-label mb-1.5 block">Degree title</label><input data-key="degree" value="${esc(education.degree)}" class="profile-input" placeholder="BSc Computer Science"></div>
                <div><label class="profile-label mb-1.5 block">Institution</label><input data-key="institution" value="${esc(education.institution)}" class="profile-input" placeholder="University or school"></div>
                <div class="md:col-span-2"><label class="profile-label mb-1.5 block">Type of degree</label><select data-key="field" class="profile-select">${typeOptions}</select></div>
            </div>
            <div><label class="profile-label mb-1.5 block">Details about it</label><textarea data-key="details" class="profile-textarea !min-h-[72px]" placeholder="Focus area, honors, thesis, relevant achievements">${esc(education.details)}</textarea></div>
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

    normalizeProfileLanguage(value) {
        return String(value || '')
            .replace(/\s*(?:[-–—:]|\()\s*(native|fluent|professional|advanced|intermediate|conversational|basic|beginner).*$/i, '')
            .trim();
    },

    renderProfileLanguages(items = []) {
        const hidden = document.getElementById('prof-languages');
        const list = document.getElementById('prof-language-list');
        if (!hidden || !list) return;
        const languages = (Array.isArray(items) ? items : this.splitCVList(hidden.value))
            .map((item) => this.normalizeProfileLanguage(item))
            .filter(Boolean);
        const uniqueLanguages = Array.from(new Set(languages.map((item) => item.toLowerCase())))
            .map((key) => languages.find((item) => item.toLowerCase() === key));
        hidden.value = uniqueLanguages.join('\n');
        list.innerHTML = languages.length
            ? uniqueLanguages.map((language, index) => `
                <span class="profile-language-box">
                    ${this.escapeHTML(language)}
                    <button type="button" class="profile-language-remove" onclick="window.app.removeProfileLanguage(${index})" aria-label="Remove ${this.escapeHTML(language)}">
                        <i data-lucide="x" class="w-3 h-3"></i>
                    </button>
                </span>
            `).join('')
            : '<span class="profile-muted">Add each language as a separate box.</span>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    addLanguageFromInput() {
        const input = document.getElementById('prof-language-input');
        const hidden = document.getElementById('prof-languages');
        if (!input || !hidden) return;
        const value = this.normalizeProfileLanguage(input.value);
        if (!value) return;
        const languages = this.splitCVList(hidden.value);
        if (!languages.some((item) => item.toLowerCase() === value.toLowerCase())) {
            languages.push(value);
        }
        input.value = '';
        this.renderProfileLanguages(languages);
    },

    removeProfileLanguage(index) {
        const hidden = document.getElementById('prof-languages');
        if (!hidden) return;
        const languages = this.splitCVList(hidden.value);
        languages.splice(index, 1);
        this.renderProfileLanguages(languages);
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
                : '<span class="text-xs font-semibold text-[#007aff]">Profile looks complete.</span>';
        }
    },

    focusProfileField(id) {
        const field = document.getElementById(id);
        if (!field) return;
        field.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => field.focus(), 250);
    },

    focusProfileSection(sectionId, fieldId) {
        const section = document.getElementById(sectionId);
        if (!section) return;
        this.updateProfileJumpState(sectionId);
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.setTimeout(() => {
            const field = document.getElementById(fieldId);
            if (field && field.offsetParent !== null) field.focus();
            this.updateProfileJumpState(sectionId);
        }, 300);
    },

    updateProfileJumpState(activeSectionId = '') {
        if (this.state.currentStage !== 2) return;
        const buttons = Array.from(document.querySelectorAll('[data-profile-jump]'));
        if (!buttons.length) return;
        let activeId = activeSectionId;
        const sections = Array.from(document.querySelectorAll('[data-profile-section]'));
        if (!activeId && sections.length) {
            const activationLine = Math.min(220, window.innerHeight * 0.35);
            activeId = sections[0].dataset.profileSection;
            sections.forEach((section) => {
                if (section.getBoundingClientRect().top <= activationLine) {
                    activeId = section.dataset.profileSection;
                }
            });
        }
        buttons.forEach((button) => {
            button.classList.toggle('is-active', button.dataset.profileJump === activeId);
        });
    },

    saveProfile(continueToSetup = false) {
        const nameEl = document.getElementById('prof-name');
        const fieldEl = document.getElementById('prof-field');
        const skillsEl = document.getElementById('prof-skills');
        const coursesEl = document.getElementById('prof-courses');
        const projectsEl = document.getElementById('prof-projects');
        const experienceEl = document.getElementById('prof-experience');
        const targetRoleEl = document.getElementById('prof-target-role');
        const locationEl = document.getElementById('prof-location');
        const summaryEl = document.getElementById('prof-summary');
        const languagesEl = document.getElementById('prof-languages');
        const pendingLanguageEl = document.getElementById('prof-language-input');
        if (pendingLanguageEl?.value.trim()) this.addLanguageFromInput();
        
        this.state.user.name = nameEl ? nameEl.value.trim() : '';
        this.state.user.field = fieldEl ? fieldEl.value.trim() : 'Software Engineering';
        this.state.user.skills = skillsEl ? skillsEl.value.trim() : '';
        this.state.user.courses = coursesEl ? coursesEl.value.trim() : '';
        this.state.user.projects = projectsEl ? projectsEl.value.trim() : '';
        this.state.user.experience = experienceEl ? experienceEl.value.trim() : '';
        this.state.user.targetRole = targetRoleEl ? targetRoleEl.value.trim() : '';
        this.state.user.location = locationEl ? locationEl.value.trim() : '';
        this.state.user.summary = summaryEl ? summaryEl.value.trim() : '';
        this.state.user.languages = languagesEl ? languagesEl.value.trim() : '';

        const cvData = this.normalizeCVData(this.state.user.cvData || {});
        cvData.targetRole = this.state.user.targetRole;
        cvData.location = this.state.user.location;
        cvData.summary = this.state.user.summary;
        cvData.education = this.collectProfileEducation();
        cvData.relevantCourses = this.splitCVList(this.state.user.courses);
        const structuredSkillNames = new Set(Object.values(cvData.skills).flat().map((skill) => skill.toLowerCase()));
        const additionalSkills = this.splitCVList(this.state.user.skills).filter((skill) => !structuredSkillNames.has(skill.toLowerCase()));
        cvData.skills.other = [...cvData.skills.other, ...additionalSkills];
        cvData.certifications = cvData.education
            .filter((item) => String(item.field || '').toLowerCase() === 'certification')
            .map((item) => item.degree)
            .filter(Boolean);
        this.state.user.certifications = cvData.certifications.join('\n');
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
        const cvData = this.normalizeCVData(this.state.user.cvData || {});
        const extraFields = {
            'prof-target-role': this.state.user.targetRole || cvData.targetRole,
            'prof-location': this.state.user.location || cvData.location,
            'prof-summary': this.state.user.summary || cvData.summary,
            'prof-languages': this.state.user.languages || cvData.languages.join('\n')
        };

        if (nameEl) nameEl.value = this.state.user.name || '';
        if (fieldEl) fieldEl.value = this.state.user.field || '';
        if (skillsEl) skillsEl.value = this.state.user.skills || '';
        if (coursesEl) coursesEl.value = this.state.user.courses || '';
        if (projectsEl) projectsEl.value = this.state.user.projects || cvData.projects.map((item) => [item.name, item.role, item.description, item.technologies?.join(', '), item.impact].filter(Boolean).join(' — ')).join('\n');
        if (experienceEl) experienceEl.value = this.state.user.experience || '';
        Object.entries(extraFields).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.value = value || '';
        });
        const certificationEducation = cvData.certifications.map((name) => ({
            degree: name,
            institution: '',
            field: 'Certification',
            startDate: '',
            endDate: '',
            details: ''
        }));
        const educationItems = [
            ...cvData.education,
            ...certificationEducation.filter((cert) => !cvData.education.some((item) => item.degree === cert.degree && item.field === 'Certification'))
        ];
        this.renderProfileEducation(educationItems);
        this.renderProfileLanguages(this.splitCVList(document.getElementById('prof-languages')?.value || ''));
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
            tabUpload.classList.toggle('is-active', isUpload);
            tabUpload.classList.toggle('border-brand-500', isUpload);
            tabUpload.classList.toggle('text-brand-600', isUpload);
            tabUpload.classList.toggle('border-transparent', !isUpload);
            tabUpload.classList.toggle('text-slate-400', !isUpload);
        }
        if (tabPaste) {
            tabPaste.classList.toggle('is-active', !isUpload);
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
        parsed.education = [
            ...parsed.education,
            ...parsed.certifications.map((name) => ({
                degree: name,
                institution: '',
                field: 'Certification',
                startDate: '',
                endDate: '',
                details: ''
            }))
        ];
        const fields = [
            { id: 'prof-name', value: parsed.name, confidence: confidence.name, stateKey: 'name' },
            { id: 'prof-target-role', value: parsed.targetRole, confidence: 'medium', stateKey: 'targetRole' },
            { id: 'prof-location', value: parsed.location, confidence: 'medium', stateKey: 'location' },
            { id: 'prof-summary', value: parsed.summary, confidence: 'medium', stateKey: 'summary' },
            { id: 'prof-skills', value: allSkills, confidence: confidence.skills, stateKey: 'skills' },
            { id: 'prof-courses', value: parsed.relevantCourses.join(', '), confidence: confidence.education, stateKey: 'courses' },
            { id: 'prof-projects', value: projectText, confidence: confidence.projects, stateKey: 'projects' },
            { id: 'prof-experience', value: experienceText, confidence: confidence.experience, stateKey: 'experience' },
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
        this.renderProfileLanguages(parsed.languages);
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
        
        const name = this.state.user.name || (this.state.isGuest ? 'Guest User' : '');
        const initials = name ? name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : 'U';

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
        const sessionPayload = {
            ...this.state.currentUser,
            email,
            profile: users[email].profile,
            sessions: users[email].sessions,
            isGuest: false
        };
        this.state.currentUser = sessionPayload;
        localStorage.setItem('prepwise_session_v3', JSON.stringify(sessionPayload));

        if (sessionPayload.provider === 'supabase' && this.state.supabaseSession) {
            this.upsertSupabaseProfile().catch((error) => {
                console.warn('[PrepWise Auth] Supabase profile upsert failed:', error.message);
            });
        }
    },

    async signOut() {
        if (this.supabase) {
            try {
                const { error } = await this.supabase.auth.signOut();
                if (error) console.warn('[PrepWise Auth] Supabase sign-out failed:', error.message);
            } catch (error) {
                console.warn('[PrepWise Auth] Supabase sign-out failed:', error.message);
            }
        }
        localStorage.removeItem('prepwise_session_v3');
        this.state.currentUser = null;
        this.state.supabaseSession = null;
        this.state.isGuest = false;
        window.location.href = `${window.location.origin}${window.location.pathname}`;
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
            const hideMobileNav = stageNum === 0 || stageNum === 1 || stageNum === 2 || stageNum === 6 || stageNum === 8;
            mobileNav.classList.toggle('hidden', hideMobileNav);
            mobileNav.classList.toggle('flex', !hideMobileNav);
        }
        document.querySelectorAll('[data-nav-stage]').forEach((link) => {
            link.classList.toggle('active', Number(link.dataset.navStage) === stageNum);
        });

        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        if (stageNum === 2) window.setTimeout(() => this.updateProfileJumpState(), 150);
        if (stageNum === 7 && !this.state.currentPracticeFocus) {
            if (!Number.isInteger(this.state.activePracticeSessionIndex)) this.state.activePracticeSessionIndex = 0;
            window.setTimeout(() => this.startPractice(), 0);
        }
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
        if (!status && !container) return;
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
        const questionKind = document.getElementById('int-question-kind');
        const stageLabel = document.getElementById('int-stage-label');
        const nextBtn = document.getElementById('int-submit-btn');
        const editArea = document.getElementById('int-answer-area');
        const skipButton = document.getElementById('int-skip-btn');
        const muteBtn = document.getElementById('int-mute-btn');
        this.state.isReadingQuestion = false;
        if (window.speechSynthesis) window.speechSynthesis.cancel();

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
        if (questionKind) {
            const kinds = { follow_up: 'Follow-up on your answer', technical: 'Job-specific topic', behavioral: 'Behavioral topic', situational: 'Situational scenario', role_fit: 'Role-fit topic', experience: 'From your profile', closing: 'Closing question', opening: 'Opening question' };
            const topic = currentMeta.topic || this.state.interview.currentTopic;
            const label = currentMeta.isFollowUp
                ? `Follow-up${topic ? ` · ${topic}` : ''}`
                : (this.state.interview.currentStage === 'opening' ? '' : (topic || kinds[this.state.interview.currentQuestionType] || 'New topic'));
            questionKind.textContent = label;
            questionKind.classList.toggle('hidden', !label);
        }
        if (stageLabel) stageLabel.textContent = this.interviewStageLabel(this.state.interview.currentStage);
        const reason = document.getElementById('int-question-reason');
        if (reason) reason.textContent = this.state.interview.currentQuestionReason || currentMeta.reason || 'This question checks your fit for the role.';
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
        if (muteBtn) {
            muteBtn.innerHTML = this.state.interviewMuted
                ? '<i data-lucide="volume-2" class="w-4 h-4"></i> Sound on'
                : '<i data-lucide="volume-2" class="w-4 h-4"></i> Sound off';
        }
        document.getElementById('int-clarification-panel')?.classList.add('hidden');
        this.updateAnswerState();
        this.setInterviewStatus(currentMeta.isFollowUp ? 'Follow-up based on your previous answer' : `New ${this.interviewStageLabel(this.state.interview.currentStage).toLowerCase()} topic`);

        this.updateInterviewProgress();
        if (!this.state.interviewMuted && currentQ) {
            window.setTimeout(() => {
                if (this.state.interview.questions[this.state.interview.currentQuestionIndex] === currentQ && !this.state.interviewMuted) {
                    this.speak(currentQ);
                }
            }, 450);
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    showAIBridge(data, callback) {
        if (callback) callback();
    },

    toggleQuestionReadAloud() {
        const button = document.getElementById('int-read-aloud-btn');
        const question = this.state.interview.questions[this.state.interview.currentQuestionIndex] || document.getElementById('interviewer-question-text')?.textContent || '';
        if (!question || this.state.interviewMuted) return;

        if (this.state.isReadingQuestion || (window.speechSynthesis && window.speechSynthesis.speaking)) {
            if (window.speechSynthesis) window.speechSynthesis.cancel();
            this.state.isReadingQuestion = false;
            if (button) button.innerHTML = '<i data-lucide="volume-2" class="w-4 h-4"></i> Read aloud';
            if (typeof lucide !== 'undefined') lucide.createIcons();
            return;
        }

        this.state.isReadingQuestion = true;
        if (button) button.innerHTML = '<i data-lucide="volume-x" class="w-4 h-4"></i> Stop';
        this.speak(question, () => {
            this.state.isReadingQuestion = false;
            if (button) button.innerHTML = '<i data-lucide="volume-2" class="w-4 h-4"></i> Read aloud';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        });
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    toggleInterviewMute() {
        this.state.interviewMuted = !this.state.interviewMuted;
        this.state.isReadingQuestion = false;
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        const button = document.getElementById('int-mute-btn');
        if (button) {
            button.innerHTML = this.state.interviewMuted
                ? '<i data-lucide="volume-2" class="w-4 h-4"></i> Sound on'
                : '<i data-lucide="volume-2" class="w-4 h-4"></i> Sound off';
        }
        this.setInterviewStatus(this.state.interviewMuted ? 'Speech muted' : 'Speech on');
        if (typeof lucide !== 'undefined') lucide.createIcons();
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
        const projectNote = this.splitCVList(this.state.user.projects)[0];
        const experienceNote = this.splitCVList(this.state.user.experience)[0];
        const education = this.state.user.cvData?.education?.[0]?.degree || this.state.user.courses;
        const experience = this.state.user.cvData?.projects?.[0]?.name
            || projectNote
            || this.state.user.cvData?.experience?.[0]?.title
            || experienceNote
            || education
            || 'a relevant project or experience';
        const questions = {
            opening: `I noticed your profile is aimed at ${role}. Give me a brief introduction, and connect it to the experience you think matters most for this role.`,
            role_fit: `Looking at your background, what part of the ${role} responsibilities do you already have evidence for, and where would you need to ramp up fastest?`,
            experience: `I saw ${experience} in your profile. Walk me through what you personally owned, the decisions you made, and the result.`,
            behavioral: `Tell me about a time one of your profile experiences required teamwork or handling pressure. What happened, what did you do, and what changed because of it?`,
            technical: `You listed ${skill}. How have you used it in a real project or course, and what trade-offs did you have to think through?`,
            closing: `Based on your profile and the role requirements, what is the strongest evidence that you are ready for this ${role} opportunity?`
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
                responses: JSON.parse(JSON.stringify(this.state.interview.responses || [])),
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
            const hideLowEvidenceLine = /not enough evidence in the transcript to judge performance/i.test(firstLine);
            el('rep-summary').textContent = hideLowEvidenceLine ? '' : (firstLine.length > 130 ? `${firstLine.slice(0, 127).trim()}...` : firstLine);
        }
        renderBulletList('rep-top-strength', report.strengths?.length ? report.strengths : [report.top_strength], 'No clear strength yet.');
        renderBulletList('rep-main-improvement', report.improvements?.length ? report.improvements : [report.main_improvement], 'No clear improvement area yet.');

        const qReviewContainer = el('rep-q-review');
        if (qReviewContainer) {
            const items = this.buildReportQuestionItems(report);
            qReviewContainer.innerHTML = items.length ? items.map((item, i) => {
                if (item.status === 'skipped') {
                    const goodAnswer = this.buildSkippedAnswerExample(item, report);
                    return `
                        <article class="report-question-card report-question-card--skipped">
                            <div class="report-question-top">
                                <div>
                                    <p class="report-question-meta">Question ${i + 1}</p>
                                    <p class="report-question-text">${this.escapeHTML(item.question)}</p>
                                </div>
                                <span class="report-score-chip report-score-chip--skipped shrink-0">Skipped</span>
                            </div>
                            <p class="report-skipped-note"><i data-lucide="circle-dashed"></i><span>No answer was given, so this question was not scored.</span></p>
                            <details class="report-example">
                                <summary class="report-answer-toggle cursor-pointer list-none" style="font-size:0.95rem; font-weight:700; color:#172033;">
                                    <span>Good answer example</span>
                                    <i data-lucide="chevron-down" style="width:1rem; height:1rem; transition:transform 0.18s ease; color:#86868b;"></i>
                                </summary>
                                <p style="margin-top:1rem; font-size:0.95rem; color:#273446; line-height:1.6;">${this.escapeHTML(goodAnswer)}</p>
                            </details>
                        </article>
                    `;
                }
                const review = item.review;
                return `
                    <article class="report-question-card">
                        <div class="report-question-top">
                            <div>
                                <p class="report-question-meta">Question ${i + 1}</p>
                                <p class="report-question-text">${this.escapeHTML(review.question)}</p>
                            </div>
                            <span class="report-score-chip shrink-0">${this.escapeHTML(review.score)}/10</span>
                        </div>
                        <div>
                            <p style="font-size:0.85rem; font-weight:600; color:#86868b; margin-bottom:0.75rem;">Your answer</p>
                            <div class="report-answer-box">
                                ${this.escapeHTML(review.answer)}
                            </div>
                        </div>
                        <div class="report-two-col">
                            <div class="report-feedback-soft report-feedback-soft--positive">
                                <p style="font-size:0.85rem; font-weight:700; color:#007aff; margin-bottom:0.75rem;">Strengths</p>
                                <ul class="report-bullet-list">
                                    ${(splitIntoBullets(review.what_went_well).length ? splitIntoBullets(review.what_went_well) : ['No clear strength was demonstrated yet.']).map((point) => `<li><span class="report-bullet-dot report-bullet-dot--positive"></span><span>${this.escapeHTML(point)}</span></li>`).join('')}
                                </ul>
                            </div>
                            <div class="report-feedback-soft report-feedback-soft--improve">
                                <p style="font-size:0.85rem; font-weight:700; color:#6e7bff; margin-bottom:0.75rem;">To improve</p>
                                <ul class="report-bullet-list">
                                    ${(splitIntoBullets(review.what_to_improve).length ? splitIntoBullets(review.what_to_improve) : ['Add a clearer example and outcome.']).map((point) => `<li><span class="report-bullet-dot report-bullet-dot--improve"></span><span>${this.escapeHTML(point)}</span></li>`).join('')}
                                </ul>
                            </div>
                        </div>
                        <details class="report-example">
                            <summary class="report-answer-toggle cursor-pointer list-none" style="font-size:0.95rem; font-weight:700; color:#172033;">
                                <span>Better answer example</span>
                                <i data-lucide="chevron-down" style="width:1rem; height:1rem; transition:transform 0.18s ease; color:#86868b;"></i>
                            </summary>
                            <p style="margin-top:1rem; font-size:0.95rem; color:#273446; line-height:1.6;">${this.escapeHTML(review.better_answer_example)}</p>
                        </details>
                    </article>
                `;
            }).join('') : '<div class="text-sm text-slate-500">No questions were available to review.</div>';
        }

        this.renderReportDetails(report);
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    buildReportQuestionItems(report) {
        const reviews = [...(report.questionReviews || [])];
        const responses = Array.isArray(report.responses) ? report.responses : [];
        if (responses.length) {
            let reviewIndex = 0;
            return responses
                .filter((response) => response?.question)
                .map((response) => {
                    if (response.status === 'skipped') {
                        return {
                            status: 'skipped',
                            question: response.question,
                            stage: response.stage,
                            topic: response.topic,
                            jobRequirement: response.jobRequirement
                        };
                    }
                    const review = reviews[reviewIndex++] || {
                        question: response.question,
                        answer: response.answer,
                        score: '--',
                        what_went_well: '',
                        what_to_improve: '',
                        better_answer_example: ''
                    };
                    return { status: 'answered', review };
                });
        }

        return [
            ...reviews.map((review) => ({ status: 'answered', review })),
            ...(report.skippedQuestions || []).map((item) => ({
                status: 'skipped',
                question: item.question,
                stage: item.stage,
                topic: item.topic,
                jobRequirement: item.jobRequirement
            }))
        ];
    },

    buildSkippedAnswerExample(item, report = {}) {
        const user = this.state.user || {};
        const cvData = this.normalizeCVData(user.cvData || {});
        const role = user.targetRole || report.targetRole || user.field || report.field || 'this role';
        const skills = [
            ...this.splitCVList(user.skills),
            ...Object.values(cvData.skills || {}).flat()
        ].filter(Boolean);
        const projects = [
            ...this.splitCVList(user.projects),
            ...(cvData.projects || []).map((project) => project.name || project.description).filter(Boolean)
        ];
        const experience = [
            ...this.splitCVList(user.experience),
            ...(cvData.experience || []).map((entry) => entry.title || entry.description).filter(Boolean)
        ];
        const evidence = projects[0] || experience[0] || user.summary || cvData.summary || '';
        const skillText = skills.slice(0, 2).join(' and ') || item.topic || item.jobRequirement || 'the required skills';
        const evidenceText = evidence
            ? `For example, in ${evidence.split(/\n|\||—|-/)[0].trim()}, I used ${skillText} to understand the problem, take ownership of my part, and explain the result clearly.`
            : `For example, I would choose one relevant project, explain my responsibility, the action I took, and the result.`;

        return `A strong answer would connect directly to ${role}: ${evidenceText} I would finish by linking that example back to what this role needs and what I can contribute next.`;
    },

    renderReportDetails(report) {
        const cleanFitText = (value) => {
            const text = String(value || '').trim();
            if (!text) return '';
            return text
                .replace(/^Target role:\s*/i, '')
                .replace(/\s+in your skills$/i, '')
                .replace(/^Stronger evidence for\s+/i, '')
                .replace(/^Interview evidence for\s+/i, '')
                .replace(/^Add one profile example for\s+/i, 'Example: ')
                .replace(/^Fill the biggest gap:\s*/i, '')
                .replace(/\s+/g, ' ')
                .trim();
        };
        const compactItems = (items) => {
            const seen = new Set();
            return (items || [])
                .map((item) => cleanFitText(item))
                .filter(Boolean)
                .filter((item) => {
                    const key = item.toLowerCase();
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                })
                .slice(0, 3);
        };
        const renderFitList = (id, items, emptyText) => {
            const container = document.getElementById(id);
            if (!container) return;
            const compact = compactItems(items);
            container.innerHTML = compact.length
                ? compact.map((item) => `<li>${this.escapeHTML(item)}</li>`).join('')
                : `<li class="is-empty">${emptyText}</li>`;
        };
        const profileFit = this.buildReportProfileFit(report);
        renderFitList('rep-fit-ready', profileFit.have, 'No clear match yet');
        renderFitList('rep-fit-gaps', profileFit.missing, 'No major gap');
    },

    buildReportProfileFit(report) {
        const user = this.state.user || {};
        const cvData = this.normalizeCVData(user.cvData || {});
        const skills = [
            ...this.splitCVList(user.skills),
            ...Object.values(cvData.skills || {}).flat()
        ].filter(Boolean);
        const projects = [
            ...this.splitCVList(user.projects),
            ...(cvData.projects || []).map((item) => item.name || item.description).filter(Boolean)
        ];
        const experience = [
            ...this.splitCVList(user.experience),
            ...(cvData.experience || []).map((item) => item.title || item.description).filter(Boolean)
        ];
        const profileEducation = this.collectProfileEducation();
        const education = (cvData.education || []).length ? cvData.education : profileEducation;
        const languages = this.splitCVList(user.languages || cvData.languages?.join('\n'));
        const requirementsToPractice = report.requirementsToPractice || [];
        const requirementsCovered = report.requirementsCovered || [];
        const technicalGaps = report.technicalGaps || [];
        const targetRole = user.targetRole || report.targetRole || user.field || report.field || '';

        const have = [];
        if (skills.length) have.push(skills.slice(0, 3).join(', '));
        if (projects.length) have.push('Projects');
        if (experience.length) have.push('Experience');
        if (targetRole) have.push(targetRole);
        if (education.length) have.push('Education');
        if (languages.length) have.push(languages.slice(0, 2).join(', '));
        requirementsCovered.slice(0, 1).forEach((item) => have.push(item));

        const missing = [];
        if (!targetRole) missing.push('Target role');
        if (!user.summary && !cvData.summary) missing.push('Short summary');
        if (!skills.length) missing.push('Skills');
        if (!projects.length) missing.push('Projects');
        if (projects.length && projects.every((item) => !/\d|impact|result|improved|reduced|increased/i.test(item))) missing.push('Project results');
        if (!experience.length) missing.push('Experience');
        if (!education.length) missing.push('Education');
        requirementsToPractice.slice(0, 2).forEach((item) => missing.push(item));
        technicalGaps.slice(0, 1).forEach((item) => missing.push(item));

        const next = [];
        if (requirementsToPractice.length) next.push(`Example: ${requirementsToPractice[0]}`);
        if (!projects.length || projects.every((item) => !/\d|impact|result|improved|reduced|increased/i.test(item))) {
            next.push('Project result');
        }
        if (!user.summary && !cvData.summary) next.push('Role summary');
        if (skills.length && projects.length) next.push('Skill-to-project link');
        if (!next.length && missing.length) next.push(missing[0]);

        return { have, missing, next };
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
            field: this.state.user.targetRole || this.state.user.field,
            jobDescription: this.state.job.description || '',
            targetRole: this.state.user.targetRole || this.state.user.field || '',
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
    getPracticeCategories() {
        return [
            {
                type: 'category',
                key: 'intro',
                title: 'Intro',
                source: 'Interview start',
                improvement: 'Practice a clear 60-second introduction tied to the role.'
            },
            {
                type: 'category',
                key: 'role_fit',
                title: 'Role fit',
                source: 'Role match',
                improvement: 'Connect your background to the role requirements.'
            },
            {
                type: 'category',
                key: 'cv',
                title: 'CV',
                source: 'Profile',
                improvement: 'Explain your projects, skills, and experience with evidence.'
            },
            {
                type: 'category',
                key: 'behavioral',
                title: 'Behavioral',
                source: 'Soft skills',
                improvement: 'Use a real example with situation, action, and result.'
            },
            {
                type: 'category',
                key: 'technical',
                title: 'Technical',
                source: 'Job skills',
                improvement: 'Show depth in the skills required for this role.'
            },
            {
                type: 'category',
                key: 'closing',
                title: 'Closing',
                source: 'Final answer',
                improvement: 'Practice a strong final fit answer or thoughtful question.'
            }
        ];
    },

    practiceSession(index) {
        if (!this.state.sessions[index]) return;
        this.state.activePracticeSessionIndex = index;
        this.state.currentPracticeFocus = null;
        this.state.currentPracticeFocusIndex = null;
        this.startPractice();
    },

    recommendedPracticeCategoryIndex(session = this.state.sessions[0]) {
        if (!session) return 0;
        const scores = session.dimensionScores || {};
        const entries = Object.entries(scores)
            .filter(([, score]) => Number.isFinite(Number(score)))
            .sort((a, b) => Number(a[1]) - Number(b[1]));
        const weakest = entries[0]?.[0] || '';
        if (weakest === 'technical_depth' || (session.technicalGaps || []).length) return 4;
        if (weakest === 'role_relevance' || (session.requirementsToPractice || []).length) return 1;
        if (weakest === 'evidence_and_impact') return 2;
        if (weakest === 'answer_structure' || weakest === 'communication_clarity') return 0;
        return 0;
    },

    getActivePracticeSession() {
        const index = Number.isInteger(this.state.activePracticeSessionIndex) ? this.state.activePracticeSessionIndex : 0;
        return this.state.sessions[index] || this.state.sessions[0] || null;
    },

    buildPracticeFocusOptions(session = this.getActivePracticeSession()) {
        const role = session?.targetRole || session?.field || this.state.user.targetRole || this.state.user.field || 'your role';
        const requirement = session?.requirementsToPractice?.[0] || session?.technicalGaps?.[0] || '';
        return this.getPracticeCategories().map((category) => ({
            ...category,
            role,
            requirement,
            jobDescription: session?.jobDescription || this.state.job.description || '',
            interviewMode: session?.mode || this.state.interviewMode
        }));
    },

    renderPracticeFocusOptions(options, activeIndex = 0) {
        const list = document.getElementById('practice-focus-list');
        if (!list) return;
        list.innerHTML = options.map((option, index) => `
            <button type="button" onclick="window.app.startPractice(${index}, true)" class="practice-focus-chip ${index === activeIndex ? 'is-active' : ''}">
                <span>${this.escapeHTML(option.title)}</span>
            </button>
        `).join('');
    },

    buildLocalPracticeQuestion(focus) {
        const role = focus.role || this.state.user.targetRole || this.state.user.field || 'this role';
        const skill = focus.requirement || this.splitCVList(this.state.user.skills)[0] || 'a relevant skill';
        const questions = {
            intro: `Give me a short introduction and connect your background to ${role}.`,
            role_fit: `Why are you a strong fit for ${role}, and what evidence from your background proves it?`,
            cv: `Walk me through one project or experience from your CV that matters for ${role}.`,
            behavioral: `Tell me about a time you handled a challenge with a team. What did you do?`,
            technical: `How have you used ${skill} in a real project, and what trade-off did you make?`,
            closing: `What is one thoughtful question you would ask at the end of a ${role} interview?`
        };
        return questions[focus.key] || questions.intro;
    },

    exitPractice() {
        const returnStage = this.state.practiceReturnStage === 6 ? 6 : 1;
        this.goToStage(returnStage);
    },

    async startPractice(focusIndex = null, forceNew = false) {
        const el = (id) => document.getElementById(id);
        if (this.state.currentStage !== 7) {
            this.state.practiceReturnStage = this.state.currentStage === 6 ? 6 : 1;
        }
        const practiceSession = this.getActivePracticeSession();
        const options = this.buildPracticeFocusOptions(practiceSession);
        const activeIndex = Number.isInteger(focusIndex)
            ? Math.max(0, Math.min(options.length - 1, focusIndex))
            : (Number.isInteger(this.state.currentPracticeFocusIndex) ? this.state.currentPracticeFocusIndex : 0);
        const focus = options[activeIndex] || options[0];

        this.state.currentPracticeFocusIndex = activeIndex;
        this.state.currentPracticeFocus = focus;
        this.state.currentPracticeWeakness = focus.title;
        this.renderPracticeFocusOptions(options, activeIndex);

        if (el('practice-answer-input')) el('practice-answer-input').value = '';
        if (el('practice-feedback-container')) el('practice-feedback-container').classList.add('hidden');
        if (el('practice-container')) el('practice-container').classList.add('hidden');
        if (el('practice-loading')) el('practice-loading').classList.remove('hidden');
        if (el('practice-source')) el('practice-source').textContent = focus.source || 'Latest report';
        if (el('practice-focus-score')) {
            el('practice-focus-score').classList.add('hidden');
            el('practice-focus-score').textContent = '';
        }

        this.goToStage(7);

        try {
            const result = await this.postJSON('/api/practice-question', {
                focus,
                student_profile: this.state.user,
                job_description: focus.jobDescription || this.state.job.description,
                recent_questions: (practiceSession?.questionReviews || []).map((review) => review.question).filter(Boolean)
            });
            this.state.currentPracticeQuestion = result.practice_question || this.buildLocalPracticeQuestion(focus);
            if (el('practice-question')) el('practice-question').textContent = this.state.currentPracticeQuestion;
            if (el('practice-target-fix')) el('practice-target-fix').textContent = result.target_fix || focus.improvement || '';
            if (el('practice-source')) el('practice-source').textContent = result.source || focus.source || 'Latest report';
            if (el('practice-loading')) el('practice-loading').classList.add('hidden');
            if (el('practice-container')) el('practice-container').classList.remove('hidden');
        } catch (err) {
            console.error("Failed to generate practice question:", err);
            this.state.currentPracticeQuestion = this.buildLocalPracticeQuestion(focus);
            if (el('practice-question')) el('practice-question').textContent = this.state.currentPracticeQuestion;
            if (el('practice-target-fix')) el('practice-target-fix').textContent = focus.improvement || 'Use a specific example and result.';
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
            btn.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Checking...';
        }

        try {
            const feedback = await this.postJSON('/api/practice-feedback', {
                focus: this.state.currentPracticeFocus || { title: this.state.currentPracticeWeakness },
                practice_question: this.state.currentPracticeQuestion || el('practice-question')?.textContent || '',
                answer,
                student_profile: this.state.user,
                job_description: this.state.currentPracticeFocus?.jobDescription || this.state.job.description
            });

            if (el('practice-feedback-score')) el('practice-feedback-score').textContent = Number.isFinite(Number(feedback.score)) ? Number(feedback.score).toFixed(1) : '--';
            if (el('practice-feedback-strength')) el('practice-feedback-strength').textContent = feedback.strength || 'You answered the question.';
            if (el('practice-feedback-fix')) el('practice-feedback-fix').textContent = feedback.fix || 'Add a clearer action and result.';
            if (el('practice-feedback-next')) el('practice-feedback-next').textContent = feedback.next_try || 'Try again with one specific example.';
            if (el('practice-feedback-container')) el('practice-feedback-container').classList.remove('hidden');
            
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        } catch (err) {
            console.error("Failed to analyze practice answer:", err);
            if (el('practice-feedback-score')) el('practice-feedback-score').textContent = '--';
            if (el('practice-feedback-strength')) el('practice-feedback-strength').textContent = 'You practiced the right area.';
            if (el('practice-feedback-fix')) el('practice-feedback-fix').textContent = 'Add one concrete action and one outcome.';
            if (el('practice-feedback-next')) el('practice-feedback-next').textContent = 'Try again with a STAR-style answer.';
            if (el('practice-feedback-container')) el('practice-feedback-container').classList.remove('hidden');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = 'Check answer <i data-lucide="sparkles" class="w-4 h-4"></i>';
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
        this.state.activePracticeSessionIndex = index;
        this.state.currentPracticeFocus = null;
        this.state.currentPracticeFocusIndex = null;
        
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
            technicalGaps: s.technicalGaps || [],
            targetRole: s.targetRole || s.field || '',
            field: s.field || '',
            skippedQuestions: s.skippedQuestions || [],
            responses: s.responses || [],
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
                el('dash-profile-missing').innerHTML = `<li class="dashboard-missing-item">Profile complete</li>`;
            } else {
                el('dash-profile-missing').innerHTML = missing.map(m => `<li class="dashboard-missing-item">${this.escapeHTML(m)}</li>`).join('');
            }
        }

        // Readiness Score Card
        const hasInterviews = this.state.sessions.length > 0;
        if (el('dash-welcome-copy')) {
            el('dash-welcome-copy').textContent = hasInterviews
                ? 'Your latest report is ready. Practice from History when you want role-specific questions.'
                : (pct >= 60
                    ? 'Your profile has enough context. Start a role-based interview when you are ready.'
                    : 'Start with your profile so the interviewer can ask questions that fit your background and goals.');
        }
        if (!hasInterviews) {
            if (el('dash-readiness-score')) el('dash-readiness-score').textContent = "--";
            if (el('dash-readiness-score')) el('dash-readiness-score').className = "dashboard-score-empty";
            if (el('dash-readiness-desc')) el('dash-readiness-desc').textContent = "Complete an interview to unlock your score.";
            if (el('dash-score-btn')) el('dash-score-btn').textContent = "Start interview";
            if (el('dash-score-btn')) el('dash-score-btn').onclick = () => this.goToStage(3);
        } else {
            const avgScore = Math.round(this.state.sessions.slice(0, 3).reduce((acc, s) => acc + s.score, 0) / Math.min(this.state.sessions.length, 3) * 10);
            if (el('dash-readiness-score')) {
                el('dash-readiness-score').textContent = avgScore;
                el('dash-readiness-score').className = "dashboard-score-value";
            }
            if (el('dash-readiness-desc')) el('dash-readiness-desc').textContent = `Based on your last ${Math.min(this.state.sessions.length, 3)} sessions.`;
            if (el('dash-score-btn')) el('dash-score-btn').textContent = "View reports";
            if (el('dash-score-btn')) el('dash-score-btn').onclick = () => this.goToStage(8);
        }

        // Recommended Next Session Card
        if (!hasInterviews) {
            const profileReady = Boolean(this.state.user.name && this.state.user.skills && (this.state.user.experience || this.state.user.cvData?.education?.length));
            if (el('dash-session-suggestion-title')) el('dash-session-suggestion-title').textContent = profileReady ? 'Start an interview' : 'Complete your profile';
            if (el('dash-suggestion-btn')) {
                el('dash-suggestion-btn').textContent = profileReady ? 'Set up interview' : 'Continue profile';
                el('dash-suggestion-btn').onclick = () => profileReady ? this.goToStage(3) : this.openEditProfile();
            }
        } else {
            const latest = this.state.sessions[0];
            let nextMode = 'technical';
            
            if (latest.mode === 'technical') {
                nextMode = 'hr';
            } else if (latest.mode === 'hr') {
                nextMode = 'behavioral';
            }

            if (el('dash-session-suggestion-title')) el('dash-session-suggestion-title').textContent = "Start an interview";
            if (el('dash-suggestion-btn')) el('dash-suggestion-btn').textContent = "Start session";
            if (el('dash-suggestion-btn')) el('dash-suggestion-btn').onclick = () => {
                this.state.wizard.style = nextMode;
                this.goToStage(3);
            };
        }

        // Recent Interview
        if (hasInterviews) {
            if (el('dash-recent-interview')) el('dash-recent-interview').classList.remove('hidden');
            if (el('dash-recent-interview')) el('dash-recent-interview').classList.add('flex');
            if (el('dash-no-recent')) el('dash-no-recent').classList.add('hidden');

            if (el('dash-recent-list')) {
                el('dash-recent-list').innerHTML = this.state.sessions.slice(0, 3).map((session, index) => `
                    <article class="dashboard-session-row" onclick="window.app.loadSessionReport(${index})" role="button" tabindex="0" onkeydown="if(event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.app.loadSessionReport(${index}); }">
                        <div class="dashboard-session-main">
                            <div class="dashboard-session-icon"><i data-lucide="message-square" class="w-5 h-5"></i></div>
                            <div class="min-w-0">
                                <p class="dashboard-session-title">${this.escapeHTML(session.field || 'Interview session')}</p>
                                <div class="dashboard-meta">
                                    <span>${this.escapeHTML(session.mode || 'Interview')}</span>
                                    <span>${this.escapeHTML(session.date || 'Recent')}</span>
                                </div>
                            </div>
                        </div>
                        <span class="dashboard-score-pill">${this.escapeHTML(session.score ?? '--')}/10</span>
                    </article>
                `).join('');
            }
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
                <article class="history-card" onclick="window.app.loadSessionReport(${i})" role="button" tabindex="0" onkeydown="if(event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.app.loadSessionReport(${i}); }">
                    <div class="min-w-0">
                        <div class="history-main">
                            <div class="history-icon">
                                <i data-lucide="message-square" class="w-5 h-5"></i>
                            </div>
                            <div class="min-w-0">
                                <div class="history-meta">
                                    <span><i data-lucide="calendar-days" class="w-3.5 h-3.5 text-[#007aff]"></i>${this.escapeHTML(s.date || 'Recent')}</span>
                                    <span><i data-lucide="briefcase-business" class="w-3.5 h-3.5 text-[#007aff]"></i>${this.escapeHTML(s.mode || 'Interview')}</span>
                                </div>
                                <p class="history-field">${this.escapeHTML(s.field || 'Interview session')}</p>
                            </div>
                        </div>
                        <div class="history-details">
                            <div class="history-detail">
                                <p class="history-detail-label">Strength</p>
                                <p class="history-detail-text">${this.escapeHTML(s.strengths && s.strengths.length > 0 ? s.strengths[0] : 'No strength recorded yet.')}</p>
                            </div>
                            <div class="history-detail">
                                <p class="history-detail-label">Focus area</p>
                                <p class="history-detail-text">${this.escapeHTML(s.weaknesses && s.weaknesses.length > 0 ? s.weaknesses[0] : 'No focus area recorded yet.')}</p>
                            </div>
                        </div>
                    </div>
                    <div class="history-score">
                        <div class="history-score-ring">
                            <div class="text-center leading-none">
                                <span class="text-xl">${this.escapeHTML(s.score ?? '--')}</span><span class="text-xs text-[#667085]">/10</span>
                            </div>
                        </div>
                        <div class="history-actions">
                            <button onclick="event.stopPropagation(); window.app.practiceSession(${i})" class="btn-secondary !min-h-[40px] !px-4 !py-2 text-sm">Practice</button>
                            <button onclick="event.stopPropagation(); window.app.deleteSession(${i})" class="history-icon-button" title="Delete session">
                                <i data-lucide="trash-2" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>
                </article>
            `).join('');
        } else {
            list.innerHTML = `
                <div class="history-empty">
                    <div class="profile-avatar mx-auto mb-4"><i data-lucide="clock-3" class="w-6 h-6"></i></div>
                    <p class="text-lg font-bold text-[#111827]">No interviews completed yet.</p>
                    <p class="mt-2 text-sm">Once you complete an interview, its report will appear here.</p>
                    <button onclick="window.app.goToStage(3)" class="btn-primary mt-5">Start an interview</button>
                </div>
            `;
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    deleteSession(index) {
        if (!this.state.sessions[index]) return;
        this.state.pendingDeleteSessionIndex = index;
        const popup = document.getElementById('delete-session-popup');
        if (popup) popup.classList.remove('hidden');
    },

    cancelDeleteSession() {
        this.state.pendingDeleteSessionIndex = null;
        const popup = document.getElementById('delete-session-popup');
        if (popup) popup.classList.add('hidden');
    },

    confirmDeleteSession() {
        const index = this.state.pendingDeleteSessionIndex;
        if (!Number.isInteger(index) || !this.state.sessions[index]) {
            this.cancelDeleteSession();
            return;
        }
        this.state.sessions.splice(index, 1);
        this.state.pendingDeleteSessionIndex = null;
        this.saveUserData();
        this.showHistory();
        const popup = document.getElementById('delete-session-popup');
        if (popup) popup.classList.add('hidden');
        
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
    pickSpeechVoice(voices = []) {
        if (!voices.length) return null;
        const scored = voices.map((voice) => {
            const name = `${voice.name || ''} ${voice.lang || ''}`.toLowerCase();
            let score = 0;
            if (name.includes('natural')) score += 8;
            if (name.includes('premium')) score += 7;
            if (name.includes('enhanced')) score += 6;
            if (name.includes('google')) score += 4;
            if (name.includes('samantha')) score += 4;
            if (name.includes('aria')) score += 3;
            if (name.includes('jenny')) score += 3;
            if (name.includes('female')) score += 2;
            if (voice.lang && voice.lang.toLowerCase().startsWith('en')) score += 4;
            if (voice.default) score += 1;
            return { voice, score };
        }).sort((a, b) => b.score - a.score);
        return scored[0]?.voice || voices[0];
    },

    speak(text, callback, rate = 0.88) {
        if (!window.speechSynthesis || this.state.interviewMuted) { if (callback) callback(); return; }
        window.speechSynthesis.cancel();
        const ut = new SpeechSynthesisUtterance(text);
        const voices = window.speechSynthesis.getVoices();
        ut.voice = this.pickSpeechVoice(voices);
        ut.lang = ut.voice?.lang || 'en-US';
        ut.rate = rate;
        ut.pitch = 1.03;
        ut.volume = 1;
        const pulseEl = document.getElementById('ai-pulse');
        const statusEl = document.getElementById('interviewer-status');
        ut.onstart = () => { if (pulseEl) pulseEl.classList.add('opacity-100'); if (statusEl) statusEl.textContent = 'Speaking...'; };
        ut.onend = () => { if (pulseEl) pulseEl.classList.remove('opacity-100'); if (callback) callback(); };
        ut.onerror = () => { if (pulseEl) pulseEl.classList.remove('opacity-100'); if (callback) callback(); };
        window.speechSynthesis.speak(ut);
    }
};

document.addEventListener('DOMContentLoaded', () => window.app.init());
