const path = require('path');

// Put OPENAI_API_KEY in the local .env file. Never expose it in browser code.
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const OpenAI = require('openai');

const app = express();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const publicDir = path.join(__dirname, 'public');
const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;
const publicRuntimeConfig = {
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
};

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const nextQuestionSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        next_question: { type: 'string' },
        reason: { type: 'string' },
        question_type: {
            type: 'string',
            enum: ['opening', 'role_fit', 'experience', 'behavioral', 'technical', 'situational', 'follow_up', 'closing']
        },
        interview_stage: { type: 'string', enum: ['opening', 'role_fit', 'experience', 'behavioral', 'technical', 'closing'] },
        topic: { type: 'string' },
        job_requirement: { type: 'string' },
        is_follow_up: { type: 'boolean' }
    },
    required: ['next_question', 'reason', 'question_type', 'interview_stage', 'topic', 'job_requirement', 'is_follow_up']
};

const clarificationSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        rephrased_question: { type: 'string' },
        what_interviewer_checks: { type: 'string' },
        answer_hint: { type: 'string' }
    },
    required: ['rephrased_question', 'what_interviewer_checks', 'answer_hint']
};

const practiceQuestionSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        focus_title: { type: 'string' },
        practice_question: { type: 'string' },
        target_fix: { type: 'string' },
        source: { type: 'string' }
    },
    required: ['focus_title', 'practice_question', 'target_fix', 'source']
};

const practiceFeedbackSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        score: { type: 'number', minimum: 0, maximum: 10 },
        strength: { type: 'string' },
        fix: { type: 'string' },
        next_try: { type: 'string' }
    },
    required: ['score', 'strength', 'fix', 'next_try']
};

const finalReportSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        overall_score: { type: 'number', minimum: 0, maximum: 10 },
        top_strength: { type: 'string' },
        main_improvement: { type: 'string' },
        strengths: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
        improvements: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
        dimension_scores: {
            type: 'object',
            additionalProperties: false,
            properties: {
                communication_clarity: { type: 'number', minimum: 0, maximum: 10 },
                answer_structure: { type: 'number', minimum: 0, maximum: 10 },
                role_relevance: { type: 'number', minimum: 0, maximum: 10 },
                evidence_and_impact: { type: 'number', minimum: 0, maximum: 10 },
                technical_depth: { type: 'number', minimum: 0, maximum: 10 }
            },
            required: ['communication_clarity', 'answer_structure', 'role_relevance', 'evidence_and_impact', 'technical_depth']
        },
        technical_gaps: { type: 'array', items: { type: 'string' } },
        job_requirements_covered: { type: 'array', items: { type: 'string' } },
        job_requirements_to_practice: { type: 'array', items: { type: 'string' } },
        recommended_practice_questions: { type: 'array', items: { type: 'string' } },
        scoring_summary: { type: 'string' },
        final_recommendation: { type: 'string' },
        question_reviews: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    question: { type: 'string' },
                    answer: { type: 'string' },
                    score: { type: 'number', minimum: 1, maximum: 10 },
                    what_went_well: { type: 'string' },
                    what_to_improve: { type: 'string' },
                    better_answer_example: { type: 'string' }
                },
                required: [
                    'question',
                    'answer',
                    'score',
                    'what_went_well',
                    'what_to_improve',
                    'better_answer_example'
                ]
            }
        },
        action_plan: {
            type: 'array',
            minItems: 3,
            maxItems: 3,
            items: { type: 'string' }
        }
    },
    required: [
        'overall_score',
        'top_strength',
        'main_improvement',
        'strengths',
        'improvements',
        'dimension_scores',
        'technical_gaps',
        'job_requirements_covered',
        'job_requirements_to_practice',
        'recommended_practice_questions',
        'scoring_summary',
        'final_recommendation',
        'question_reviews',
        'action_plan'
    ]
};

const confidenceSchema = {
    type: 'string',
    enum: ['high', 'medium', 'low']
};

const cvSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        location: { type: 'string' },
        targetRole: { type: 'string' },
        summary: { type: 'string' },
        education: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    degree: { type: 'string' },
                    institution: { type: 'string' },
                    field: { type: 'string' },
                    startDate: { type: 'string' },
                    endDate: { type: 'string' },
                    details: { type: 'string' }
                },
                required: ['degree', 'institution', 'field', 'startDate', 'endDate', 'details']
            }
        },
        relevantCourses: { type: 'array', items: { type: 'string' } },
        skills: {
            type: 'object',
            additionalProperties: false,
            properties: {
                programmingLanguages: { type: 'array', items: { type: 'string' } },
                frameworks: { type: 'array', items: { type: 'string' } },
                tools: { type: 'array', items: { type: 'string' } },
                databases: { type: 'array', items: { type: 'string' } },
                softSkills: { type: 'array', items: { type: 'string' } },
                other: { type: 'array', items: { type: 'string' } }
            },
            required: ['programmingLanguages', 'frameworks', 'tools', 'databases', 'softSkills', 'other']
        },
        experience: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    title: { type: 'string' },
                    organization: { type: 'string' },
                    startDate: { type: 'string' },
                    endDate: { type: 'string' },
                    description: { type: 'string' },
                    skillsUsed: { type: 'array', items: { type: 'string' } }
                },
                required: ['title', 'organization', 'startDate', 'endDate', 'description', 'skillsUsed']
            }
        },
        projects: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    technologies: { type: 'array', items: { type: 'string' } },
                    role: { type: 'string' },
                    impact: { type: 'string' }
                },
                required: ['name', 'description', 'technologies', 'role', 'impact']
            }
        },
        certifications: { type: 'array', items: { type: 'string' } },
        languages: { type: 'array', items: { type: 'string' } },
        missingFields: { type: 'array', items: { type: 'string' } },
        confidence: {
            type: 'object',
            additionalProperties: false,
            properties: {
                name: confidenceSchema,
                education: confidenceSchema,
                skills: confidenceSchema,
                experience: confidenceSchema,
                projects: confidenceSchema
            },
            required: ['name', 'education', 'skills', 'experience', 'projects']
        }
    },
    required: [
        'name', 'email', 'phone', 'location', 'targetRole', 'summary', 'education',
        'relevantCourses', 'skills', 'experience', 'projects', 'certifications',
        'languages', 'missingFields', 'confidence'
    ]
};

function requireOpenAI(_req, res, next) {
    if (!openai) {
        return res.status(503).json({
            error: 'OpenAI is not configured. Add OPENAI_API_KEY to the server-side .env file.'
        });
    }
    next();
}

function text(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function stringList(value, maxItems, maxLength) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, maxItems).map((item) => text(item, maxLength)).filter(Boolean);
}

function textLines(value, maxItems = 10, maxLength = 500) {
    return text(value, maxItems * maxLength)
        .split(/\n|;|\u2022/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, maxItems)
        .map((item) => item.slice(0, maxLength));
}

function normalizeTranscript(value, maxItems = 50) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, maxItems).map((item) => ({
        role: item?.role === 'assistant' ? 'assistant' : 'user',
        content: text(item?.content, 5000)
    })).filter((item) => item.content);
}

function normalizeReviewsTranscript(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 30).filter((item) => item?.status !== 'skipped' && text(item?.answer, 8000)).map((item) => ({
        question: text(item?.question, 2000),
        answer: text(item?.answer, 8000),
        stage: text(item?.stage, 100),
        topic: text(item?.topic, 300),
        job_requirement: text(item?.jobRequirement, 500)
    })).filter((item) => item.question);
}

function normalizeSkippedQuestions(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 30).map((item) => ({
        question: text(item?.question, 2000), stage: text(item?.stage, 100),
        topic: text(item?.topic, 300), job_requirement: text(item?.jobRequirement, 500)
    })).filter((item) => item.question);
}

function interviewStageFor(length, mainQuestionsAsked) {
    const full = length === 'full';
    const mainNumber = mainQuestionsAsked + 1;
    if (mainNumber === 1) return 'opening';
    if (full) {
        if (mainNumber <= 3) return 'role_fit';
        if (mainNumber <= 6) return 'experience';
        if (mainNumber <= 9) return 'behavioral';
        if (mainNumber <= 13) return 'technical';
        return 'closing';
    }
    if (mainNumber === 2) return 'role_fit';
    if (mainNumber === 3) return 'experience';
    if (mainNumber === 4) return 'behavioral';
    if (mainNumber === 5) return 'technical';
    return 'closing';
}

function normalizeProfile(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const cv = value.cvData && typeof value.cvData === 'object' && !Array.isArray(value.cvData)
        ? value.cvData
        : {};
    const normalizeEducation = (items) => Array.isArray(items) ? items.slice(0, 10).map((item) => ({
        degree: text(item?.degree, 300), institution: text(item?.institution, 300), field: text(item?.field, 300),
        startDate: text(item?.startDate, 100), endDate: text(item?.endDate, 100), details: text(item?.details, 1500)
    })) : [];
    const normalizeExperience = (items) => Array.isArray(items) ? items.slice(0, 15).map((item) => ({
        title: text(item?.title, 300), organization: text(item?.organization, 300),
        startDate: text(item?.startDate, 100), endDate: text(item?.endDate, 100),
        description: text(item?.description, 2500), skillsUsed: stringList(item?.skillsUsed, 30, 200)
    })) : [];
    const normalizeProjects = (items) => Array.isArray(items) ? items.slice(0, 15).map((item) => ({
        name: text(item?.name, 300), description: text(item?.description, 2500),
        technologies: stringList(item?.technologies, 30, 200), role: text(item?.role, 500), impact: text(item?.impact, 1000)
    })) : [];
    const skillSource = cv.skills && typeof cv.skills === 'object' && !Array.isArray(cv.skills) ? cv.skills : {};
    const structuredSkills = {};
    ['programmingLanguages', 'frameworks', 'tools', 'databases', 'softSkills', 'other'].forEach((key) => {
        structuredSkills[key] = stringList(skillSource[key], 30, 200);
    });
    return {
        name: text(value.name, 200),
        field: text(value.field, 300),
        skills: text(value.skills, 3000),
        courses: text(value.courses, 3000),
        projectNotes: text(value.projects, 8000),
        experience: text(value.experience, 8000),
        targetRole: text(cv.targetRole || value.targetRole || value.field, 300),
        summary: text(cv.summary || value.summary, 3000),
        location: text(cv.location || value.location, 300),
        education: normalizeEducation(cv.education),
        relevantCourses: stringList(cv.relevantCourses, 30, 300),
        structuredSkills,
        projects: normalizeProjects(cv.projects),
        structuredExperience: normalizeExperience(cv.experience),
        certifications: stringList(cv.certifications, 30, 300),
        languages: stringList(cv.languages, 30, 200)
    };
}

function buildProfileEvidence(profile) {
    const evidence = [];
    const push = (label, value) => {
        const clean = text(value, 700);
        if (clean) evidence.push(`${label}: ${clean}`);
    };
    const pushList = (label, items) => {
        const clean = Array.isArray(items) ? items.map((item) => text(item, 200)).filter(Boolean) : [];
        if (clean.length) evidence.push(`${label}: ${clean.slice(0, 8).join(', ')}`);
    };

    push('Target role', profile.targetRole || profile.field);
    push('Profile summary', profile.summary);
    push('Field', profile.field);
    push('Skills', profile.skills);
    pushList('Structured skills', profile.structuredSkills ? Object.values(profile.structuredSkills).flat() : []);
    push('Relevant courses', profile.courses || profile.relevantCourses?.join(', '));

    (profile.education || []).slice(0, 4).forEach((item) => {
        push('Education', [item.degree, item.field, item.institution, item.details].filter(Boolean).join(' - '));
    });
    textLines(profile.projectNotes, 6, 500).forEach((item) => push('Project note', item));
    (profile.projects || []).slice(0, 6).forEach((item) => {
        push('CV project', [item.name, item.role, item.description, item.technologies?.join(', '), item.impact].filter(Boolean).join(' - '));
    });
    textLines(profile.experience, 6, 500).forEach((item) => push('Experience note', item));
    (profile.structuredExperience || []).slice(0, 6).forEach((item) => {
        push('CV experience', [item.title, item.organization, item.description, item.skillsUsed?.join(', ')].filter(Boolean).join(' - '));
    });
    pushList('Certifications', profile.certifications);
    pushList('Languages', profile.languages);

    return evidence.slice(0, 24);
}

const ANALYSIS_STOP_WORDS = new Set([
    'the','and','for','with','that','this','from','have','have','been','were','was','you','your','they','their',
    'them','there','what','when','where','why','how','about','into','over','under','then','than','that','because',
    'would','could','should','will','just','very','more','most','some','such','like','also','only','work','role',
    'question','answer','interview','job','team','project','using','used','use','my','me','i','it','on','in','to',
    'of','a','an','is','are','as','by','be','at','or','if','we','our','who','whom','which','so','do','did','done'
]);

const VAGUE_MARKERS = [
    'stuff', 'things', 'kind of', 'sort of', 'maybe', 'probably', 'a lot', 'etc', 'and so on',
    'basically', 'generally', 'good', 'nice', 'okay', 'helped a bit', 'somewhat', 'around', 'etc.'
];

const EXAMPLE_MARKERS = [
    'for example', 'for instance', 'one time', 'in my project', 'in my internship', 'in class',
    'when i', 'during', 'i worked on', 'i built', 'i led', 'i implemented', 'i improved',
    'i handled', 'i solved', 'i created', 'i analyzed', 'i collaborated', 'i managed'
];

const STRUCTURE_MARKERS = [
    'first', 'then', 'next', 'after that', 'finally', 'as a result', 'result', 'because',
    'situation', 'task', 'action', 'result', 'so i', 'therefore'
];

const ACTION_VERBS = [
    'built', 'implemented', 'designed', 'created', 'led', 'managed', 'analyzed', 'debugged', 'improved',
    'solved', 'developed', 'communicated', 'organized', 'delivered', 'described', 'presented', 'tested',
    'validated', 'coordinated', 'supported', 'reduced', 'increased', 'saved', 'automated', 'refined'
];

function compactText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function tokenizeAnalysisText(value) {
    return compactText(value).toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) || [];
}

function significantTokens(value) {
    return tokenizeAnalysisText(value).filter((token) => token.length > 3 && !ANALYSIS_STOP_WORDS.has(token));
}

function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function countMatches(textValue, markers) {
    const lower = compactText(textValue).toLowerCase();
    return markers.reduce((count, marker) => count + (lower.includes(marker) ? 1 : 0), 0);
}

function countRegexMatches(textValue, regex) {
    const matches = compactText(textValue).match(regex);
    return matches ? matches.length : 0;
}

function scoreInterviewAnswer(item, context) {
    const question = compactText(item?.question);
    const answer = compactText(item?.answer);
    const stage = compactText(item?.stage);
    const topic = compactText(item?.topic);
    const jobRequirement = compactText(item?.job_requirement);
    const jobDescription = compactText(context?.jobDescription);
    const profileText = compactText([
        context?.studentProfile?.targetRole,
        context?.studentProfile?.summary,
        context?.studentProfile?.field,
        context?.studentProfile?.skills,
        context?.studentProfile?.courses,
        (context?.studentProfile?.education || []).map((edu) => [edu.degree, edu.field, edu.institution, edu.details].filter(Boolean).join(' ')).join(' '),
        (context?.studentProfile?.structuredSkills ? Object.values(context.studentProfile.structuredSkills).flat() : []).join(' '),
        (context?.studentProfile?.structuredExperience || []).map((exp) => [exp.title, exp.organization, exp.description, (exp.skillsUsed || []).join(' ')].filter(Boolean).join(' ')).join(' '),
        (context?.studentProfile?.projects || []).map((project) => [project.name, project.description, (project.technologies || []).join(' '), project.role, project.impact].filter(Boolean).join(' ')).join(' ')
    ].filter(Boolean).join(' '));

    const answerWords = tokenizeAnalysisText(answer);
    const focusTokens = new Set([
        ...significantTokens(question),
        ...significantTokens(stage),
        ...significantTokens(topic),
        ...significantTokens(jobRequirement),
        ...significantTokens(jobDescription),
        ...significantTokens(profileText)
    ]);
    const overlapCount = answerWords.reduce((count, token) => count + (focusTokens.has(token) ? 1 : 0), 0);
    const overlapScore = overlapCount >= 7 ? 2 : overlapCount >= 5 ? 1.6 : overlapCount >= 3 ? 1.1 : overlapCount >= 2 ? 0.7 : overlapCount >= 1 ? 0.3 : 0;

    const wordCount = answerWords.length;
    const sentenceCount = compactText(answer).split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length || 0;
    const hasExample = EXAMPLE_MARKERS.some((marker) => answer.toLowerCase().includes(marker));
    const hasStructure = STRUCTURE_MARKERS.some((marker) => answer.toLowerCase().includes(marker));
    const vagueCount = countMatches(answer, VAGUE_MARKERS);
    const numbersOrMetrics = countRegexMatches(answer, /(\b\d+(\.\d+)?\s*%|\$\s*\d+|\b\d+\b)/g);
    const impactWords = countMatches(answer, ['result', 'results', 'impact', 'improved', 'increased', 'decreased', 'reduced', 'saved', 'faster', 'better', 'growth', 'success', 'outcome']);
    const firstPersonCount = countRegexMatches(answer, /\b(i|my|me|mine|we|our)\b/gi);
    const actionVerbCount = ACTION_VERBS.reduce((count, verb) => count + (answer.toLowerCase().includes(verb) ? 1 : 0), 0);
    const technicalTerms = countMatches(answer, ['python', 'sql', 'excel', 'react', 'node', 'api', 'database', 'dashboard', 'testing', 'debug', 'analysis', 'statistics', 'algorithm', 'framework', 'tool', 'system']);
    const answered = wordCount >= 8;
    const clearRoleConnection = overlapScore >= 0.7 ? 1 : 0;

    let score = 0;
    score += answered ? 1.1 : 0;
    score += overlapScore;
    score += clampNumber(wordCount / 40, 0, 1.25);
    score += clampNumber(countMatches(answer, ['specific', 'exactly', 'actually', 'concrete', 'clearly']) * 0.35, 0, 0.7);
    score += clampNumber(hasExample ? 1.25 : 0, 0, 1.25);
    score += clampNumber((sentenceCount >= 2 || hasStructure) ? 1 : 0.2, 0, 1);
    score += clampNumber((firstPersonCount > 2 && actionVerbCount > 0) ? 1 : firstPersonCount > 0 ? 0.5 : 0, 0, 1);
    score += clampNumber((numbersOrMetrics > 0 || impactWords > 0) ? 1.25 : 0, 0, 1.25);
    score += clampNumber((context?.interviewType === 'technical' || /technical|engineering|software|data|analysis|developer|programming/i.test(jobRequirement + ' ' + jobDescription)) ? clampNumber(technicalTerms / 2, 0, 1.2) : clampNumber((technicalTerms > 0 ? 0.6 : 0), 0, 0.6), 0, 1.2);

    if (wordCount < 20) score = Math.min(score, 3.2);
    else if (wordCount < 40) score = Math.min(score, 5.0);
    if (vagueCount > 0 && vagueCount >= Math.max(2, Math.floor(answerWords.length / 18))) score = Math.min(score, 4.8);
    if (!hasExample) score = Math.min(score, 7.0);
    if (numbersOrMetrics === 0 && impactWords === 0) score = Math.min(score, 8.4);
    if (clearRoleConnection === 0) score = Math.min(score, 4.5);

    score = clampNumber(Math.round(score * 10) / 10, 1, 10);

    const clarity = clampNumber(((sentenceCount >= 2 ? 1.5 : 0.5) + clampNumber(wordCount / 45, 0, 1.5) + (hasStructure ? 1 : 0)) * 2.2, 0, 10);
    const structure = clampNumber(((hasStructure ? 2 : 0.5) + (sentenceCount >= 3 ? 1.5 : sentenceCount >= 2 ? 1 : 0.3) + clampNumber(wordCount / 50, 0, 1)) * 2.0, 0, 10);
    const relevance = clampNumber(overlapScore * 4.5 + (clearRoleConnection ? 1.5 : 0), 0, 10);
    const evidence = clampNumber(((hasExample ? 2.3 : 0.3) + (numbersOrMetrics > 0 ? 2.3 : 0) + clampNumber(impactWords / 2, 0, 1.8) + clampNumber(wordCount / 55, 0, 1.2)) * 1.8, 0, 10);
    const technical = clampNumber(((context?.interviewType === 'technical' ? 1.5 : 0.7) + clampNumber(technicalTerms / 2, 0, 1.5) + (answerWords.length >= 40 ? 0.8 : 0.2)) * 2.0, 0, 10);

    return {
        score,
        wordCount,
        hasExample,
        hasStructure,
        numbersOrMetrics,
        impactWords,
        relevance,
        clarity,
        structure,
        evidence,
        technical,
        vagueCount
    };
}

function buildBetterAnswerExample(item, context, analysis) {
    const question = compactText(item?.question).replace(/\s+/g, ' ');
    const topic = compactText(item?.topic) || 'this topic';
    const requirement = compactText(item?.job_requirement) || compactText(context?.jobDescription).split(/[.\n]/).find(Boolean) || 'the role';
    const role = compactText(context?.studentProfile?.targetRole || context?.studentProfile?.field || context?.interviewType || 'this role');
    const intro = analysis.hasExample
        ? 'A stronger version should keep the example but add more detail and outcome.'
        : 'A stronger version should add one real example, your personal role, and the result.';

    if (/tell me about a time|describe a time|give me an example/i.test(question)) {
        return `Try: "In a ${topic} situation, I ${analysis.hasExample ? 'handled' : 'worked on'} the problem by explaining my role clearly, describing the steps I took, and ending with the result. That showed I can contribute to ${requirement} in ${role}."`;
    }
    if (/how would you|what would you do|walk me through/i.test(question)) {
        return `Try: "First, I would look at the most relevant part of the problem. Then I would use ${topic} or a similar approach, explain the trade-offs, and close with how I would measure success for ${requirement}."`;
    }
    return `${intro} For example, I would state the situation, what I personally did, and the impact it had on the outcome.`;
}

function buildScoringSummary(reportItems, interviewType, interviewLength) {
    const answers = reportItems.filter((item) => item.status === 'answered');
    if (!answers.length) {
        return 'There was not enough evidence in the transcript to judge performance. Skipped questions are not counted.';
    }

    const avg = (key) => answers.reduce((sum, item) => sum + (item.analysis?.[key] || 0), 0) / answers.length;
    const weakCounts = {
        examples: answers.filter((item) => !item.analysis?.hasExample).length,
        metrics: answers.filter((item) => !(item.analysis?.numbersOrMetrics > 0 || item.analysis?.impactWords > 0)).length,
        structure: answers.filter((item) => (item.analysis?.structure || 0) < 4.5).length,
        relevance: answers.filter((item) => (item.analysis?.relevance || 0) < 4.0).length
    };

    const parts = [];
    if (avg('score') < 5) {
        parts.push('Most answers stayed too brief or too vague, which pulled the score down.');
    } else if (avg('score') < 7) {
        parts.push('Answers were generally relevant, but several needed stronger examples and clearer outcomes.');
    } else {
        parts.push('Most answers were relevant and understandable, with good evidence in several places.');
    }
    if (weakCounts.examples > 0) parts.push('Several answers did not include a concrete example.');
    if (weakCounts.metrics > 0) parts.push('Metrics or visible impact were missing in multiple answers.');
    if (weakCounts.structure > 0) parts.push('A clearer structure would make the answers easier to follow.');
    if (interviewType === 'technical' || interviewLength === 'full') {
        parts.push('Technical depth and role-specific detail were weighted more heavily in this report.');
    }
    return parts.join(' ');
}

function summarizeDimension(label, score) {
    if (score >= 8.5) return `Strong ${label.toLowerCase()}`;
    if (score >= 6.5) return `Solid ${label.toLowerCase()}`;
    if (score >= 4.5) return `Mixed ${label.toLowerCase()}`;
    return `Weak ${label.toLowerCase()}`;
}

function buildRubricReport(transcript, skippedQuestions, context) {
    const reviews = transcript.map((item) => {
        const analysis = scoreInterviewAnswer(item, context);
        return {
            question: item.question,
            answer: item.answer,
            score: analysis.score,
            what_went_well: analysis.score >= 8
                ? 'The answer was clear, specific, and directly connected to the question.'
                : analysis.score >= 6
                    ? 'The answer stayed on topic and gave enough detail to understand the idea.'
                    : analysis.score >= 4
                        ? 'You stayed somewhat relevant, but the answer still needs more detail and evidence.'
                        : 'The answer did not give enough evidence to show clear understanding.',
            what_to_improve: analysis.score >= 8
                ? 'Keep this level of specificity, and add an impact metric if you can.'
                : !analysis.hasExample
                    ? 'Add one real example and explain what you personally did.'
                    : analysis.numbersOrMetrics === 0 && analysis.impactWords === 0
                        ? 'Include a result, outcome, or metric so the answer feels complete.'
                        : analysis.structure < 4.5
                            ? 'Use a clearer structure: situation, action, result.'
                            : 'Connect the answer more tightly to the role and keep the details precise.',
            better_answer_example: buildBetterAnswerExample(item, context, analysis),
            analysis,
            stage: item.stage,
            topic: item.topic,
            job_requirement: item.job_requirement
        };
    });

    const answered = reviews.filter((review) => review.analysis);
    const overallScore = answered.length ? clampNumber(Math.round((answered.reduce((sum, review) => sum + review.score, 0) / answered.length) * 10) / 10, 0, 10) : 0;
    const dimensionScores = answered.length
        ? {
            communication_clarity: Math.round((answered.reduce((sum, review) => sum + review.analysis.clarity, 0) / answered.length) * 10) / 10,
            answer_structure: Math.round((answered.reduce((sum, review) => sum + review.analysis.structure, 0) / answered.length) * 10) / 10,
            role_relevance: Math.round((answered.reduce((sum, review) => sum + review.analysis.relevance, 0) / answered.length) * 10) / 10,
            evidence_and_impact: Math.round((answered.reduce((sum, review) => sum + review.analysis.evidence, 0) / answered.length) * 10) / 10,
            technical_depth: Math.round((answered.reduce((sum, review) => sum + review.analysis.technical, 0) / answered.length) * 10) / 10
        }
        : { communication_clarity: 0, answer_structure: 0, role_relevance: 0, evidence_and_impact: 0, technical_depth: 0 };

    const dimensionEntries = Object.entries({
        communication_clarity: 'Communication clarity',
        answer_structure: 'Answer structure',
        role_relevance: 'Role relevance',
        evidence_and_impact: 'Evidence and impact',
        technical_depth: 'Technical depth'
    }).map(([key, label]) => [label, dimensionScores[key] || 0]);
    dimensionEntries.sort((a, b) => b[1] - a[1]);
    const topDimension = dimensionEntries[0] || ['Communication clarity', 0];
    const bottomDimension = dimensionEntries[dimensionEntries.length - 1] || ['Technical depth', 0];

    const strengths = dimensionEntries.slice(0, 3).map(([label, score]) => `${summarizeDimension(label, score)} (${score.toFixed(1)}/10)`);
    const improvements = dimensionEntries.slice(-3).reverse().map(([label, score]) => `Improve ${label.toLowerCase()} (${score.toFixed(1)}/10)`);
    const actionPlan = [
        `Turn weak answers into STAR-style responses with one concrete example.`,
        `Add a result, impact, or metric whenever you can.`,
        `Tie each answer back to the role requirement before moving on.`
    ];

    const requirementsCovered = answered
        .filter((review) => review.score >= 6 && review.job_requirement)
        .map((review) => review.job_requirement)
        .filter(Boolean);
    const requirementsToPractice = [
        ...answered.filter((review) => review.score < 6 && review.job_requirement).map((review) => review.job_requirement),
        ...skippedQuestions.map((item) => item.job_requirement).filter(Boolean)
    ].filter(Boolean);
    const technicalGaps = answered
        .filter((review) => (review.analysis.technical < 5 && review.analysis.score < 7) || (review.analysis.numbersOrMetrics === 0 && review.analysis.impactWords === 0))
        .slice(0, 3)
        .map((review) => review.job_requirement || review.topic || 'Add more technical depth and concrete evidence.');

    const recommendedPracticeQuestions = [
        ...reviews.filter((review) => review.score < 6).slice(0, 3).map((review) => `Re-answer: ${review.question}`),
        ...skippedQuestions.slice(0, 3).map((item) => `Practice the skipped question: ${item.question}`)
    ].slice(0, 5);

    const scoringSummary = buildScoringSummary(reviews, context.interviewType, context.interviewLength);
    const finalRecommendation = overallScore >= 8
        ? 'You are interview-ready, but you should keep sharpening evidence and impact to reach a stronger final round.'
        : overallScore >= 6
            ? 'You have a workable base. Improve examples, structure, and metrics before the next attempt.'
            : 'The answers need more concrete examples and clearer structure before the next interview will feel strong.';

    return {
        overall_score: overallScore,
        top_strength: topDimension[0] ? `Strongest area: ${topDimension[0]}` : 'Strongest area: Communication clarity',
        main_improvement: bottomDimension[0] ? `Main weakness: ${bottomDimension[0]}` : 'Main weakness: Evidence and impact',
        strengths,
        improvements,
        dimension_scores: dimensionScores,
        technical_gaps: technicalGaps.length ? technicalGaps : [],
        job_requirements_covered: requirementsCovered.length ? [...new Set(requirementsCovered)] : [],
        job_requirements_to_practice: requirementsToPractice.length ? [...new Set(requirementsToPractice)] : [],
        recommended_practice_questions: recommendedPracticeQuestions.length ? recommendedPracticeQuestions : [],
        scoring_summary: scoringSummary,
        final_recommendation: finalRecommendation,
        question_reviews: reviews.map((review) => ({
            question: review.question,
            answer: review.answer,
            score: review.score,
            what_went_well: review.what_went_well,
            what_to_improve: review.what_to_improve,
            better_answer_example: review.better_answer_example
        })),
        action_plan: actionPlan
    };
}

async function createStructuredResponse(name, schema, systemPrompt, payload) {
    const completion = await openai.chat.completions.create({
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(payload) }
        ],
        response_format: {
            type: 'json_schema',
            json_schema: { name, strict: true, schema }
        }
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('OpenAI returned an empty response.');
    return JSON.parse(content);
}

app.post('/api/interview-next-question', requireOpenAI, async (req, res) => {
    const interviewLength = req.body?.interview_length === 'full' ? 'full' : 'short';
    const mainQuestionTarget = interviewLength === 'full' ? 14 : 6;
    const maxQuestions = interviewLength === 'full' ? 18 : 7;
    const maxFollowUps = interviewLength === 'full' ? 4 : 1;
    const mainQuestionsAsked = Math.max(0, Math.min(mainQuestionTarget, Number(req.body?.main_questions_asked) || 0));
    const followUpsAsked = Math.max(0, Math.min(maxFollowUps, Number(req.body?.follow_ups_asked) || 0));
    const totalQuestionsAsked = Math.max(0, Math.min(maxQuestions, Number(req.body?.total_questions_asked) || 0));
    const requiredStage = totalQuestionsAsked >= maxQuestions - 1
        ? 'closing'
        : interviewStageFor(interviewLength, mainQuestionsAsked);
    const latestAnswerRaw = text(req.body?.latest_student_answer, 8000);
    const canAskFollowUp = Boolean(latestAnswerRaw) && latestAnswerRaw !== '[Question skipped]'
        && followUpsAsked < maxFollowUps
        && totalQuestionsAsked < maxQuestions - 1
        && requiredStage !== 'closing';
    const studentProfile = normalizeProfile(req.body?.student_profile);
    const payload = {
        student_profile: studentProfile,
        profile_evidence: buildProfileEvidence(studentProfile),
        job_description: text(req.body?.job_description, 12000),
        interview_type: text(req.body?.interview_type, 100),
        interview_length: interviewLength,
        interviewer_style: text(req.body?.interviewer_style, 100),
        previous_question: text(req.body?.previous_question, 2000),
        latest_student_answer: latestAnswerRaw,
        full_transcript: normalizeTranscript(req.body?.full_transcript),
        current_question_number: totalQuestionsAsked + 1,
        total_questions_allowed: maxQuestions,
        main_questions_target: mainQuestionTarget,
        main_questions_asked: mainQuestionsAsked,
        follow_ups_asked: followUpsAsked,
        follow_ups_allowed: maxFollowUps,
        required_stage_for_new_topic: requiredStage,
        can_ask_follow_up: canAskFollowUp,
        current_stage: text(req.body?.current_stage, 100),
        asked_questions: stringList(req.body?.asked_questions, 30, 2000),
        covered_job_requirements: stringList(req.body?.covered_job_requirements, 30, 500),
        skipped_questions: normalizeSkippedQuestions(req.body?.skipped_questions)
    };

    if (!payload.job_description || !payload.interview_type) {
        return res.status(400).json({ error: 'job_description and interview_type are required.' });
    }

    try {
        const result = await createStructuredResponse(
            'interview_next_question',
            nextQuestionSchema,
            `You are conducting a realistic, structured job interview as a thoughtful senior interviewer who has
read the candidate's CV/profile before the meeting. The interview should feel human, specific, and professional,
not like a quiz or a generic chatbot.

Ask exactly one concise question. Prefer a natural interviewer framing such as "I noticed on your profile..."
or "You mentioned..." when a real profile_evidence item or latest answer supports it. Use only facts present
in profile_evidence, student_profile, job_description, or the transcript; never invent employers, projects,
metrics, degrees, responsibilities, or technologies. Every question must be grounded in at least one explicit
job requirement, candidate skill, course, experience, project, education item, CV detail, language, or concrete
detail from the latest answer. Do not ask a generic question when a specific version can be asked. An opening
question may ask for an introduction, but it must name the target role or connect to one profile/CV detail.

Across the interview, cover both sides of the real interview dynamic:
- CV/profile probing: ask about claims, projects, courses, skills, education, work history, languages, or gaps
  in a way a hiring manager would naturally ask after reading a resume.
- Role fit: compare the candidate's evidence with the job description and ask about the most important fit risks.
- Depth checks: when the candidate names a skill or project, ask what they personally did, how they made decisions,
  what trade-offs they faced, what changed because of their work, and what they learned.

The required_stage_for_new_topic is the interview plan: opening, role_fit, experience, behavioral, technical,
then closing. If can_ask_follow_up is false, ask a new main question in exactly that stage. If it is true, ask
a follow-up only when the latest answer is vague, incomplete, misses the question, introduces an important
relevant detail, lacks evidence/results, or needs deeper knowledge for a stated job requirement. Otherwise
move to the required new-topic stage. For a follow-up, keep interview_stage equal to current_stage. Short
interviews should move on quickly; full interviews may probe more.
Never repeat or lightly paraphrase an asked question. Do not revisit skipped questions during this session.

Technical questions must be realistic for skills actually named in the job or profile. Behavioral questions
must connect to a relevant competency such as teamwork, pressure, conflict, learning, communication, or
problem solving. Experience questions must name a real project, course, skill, education item, or role from
the profile when one exists. If the profile is thin, ask the candidate to choose a real example rather than
pretending you saw one.
Honor the selected interview_type: HR emphasizes motivation and fit; technical emphasizes job-specific
knowledge; behavioral emphasizes evidence from past behavior; situational uses realistic role scenarios;
mixed balances all of them while still following the stage plan. Honor interviewer_style only in tone and
depth, never by becoming hostile or vague.
When required_stage_for_new_topic is closing, ask a tailored final fit or candidate-question closing question
and set is_follow_up false. reason is a short user-facing explanation of why this question is relevant; it must
not contain hidden reasoning. job_requirement is the specific requirement being checked, or the closest
profile evidence when there is no pasted job description. topic should name the concrete CV/profile/job item
being tested, not a vague category.`,
            payload
        );
        res.json(result);
    } catch (error) {
        console.error('OpenAI next-question error:', error.message);
        res.status(502).json({ error: 'Could not generate the next interview question.' });
    }
});

app.post('/api/interview-clarify', requireOpenAI, async (req, res) => {
    const currentQuestion = text(req.body?.current_question, 2000);
    if (!currentQuestion) return res.status(400).json({ error: 'current_question is required.' });
    const payload = {
        current_question: currentQuestion,
        interview_stage: text(req.body?.interview_stage, 100),
        interview_type: text(req.body?.interview_type, 100),
        question_reason: text(req.body?.question_reason, 1000),
        job_description: text(req.body?.job_description, 12000),
        student_profile: normalizeProfile(req.body?.student_profile)
    };
    try {
        const result = await createStructuredResponse(
            'interview_question_clarification',
            clarificationSchema,
            `Help a candidate understand one interview question without answering it for them. Rephrase the
same question in simpler, direct language. Explain in one sentence what competency or evidence the interviewer
is checking. Give a small structure hint, such as relevant steps or STAR, but do not provide facts, examples,
or a model answer the candidate could copy. Keep all three fields concise and preserve the original meaning.`,
            payload
        );
        res.json(result);
    } catch (error) {
        console.error('OpenAI clarification error:', error.message);
        res.status(502).json({ error: 'Could not clarify this question right now.' });
    }
});

app.post('/api/practice-question', requireOpenAI, async (req, res) => {
    const studentProfile = normalizeProfile(req.body?.student_profile);
    const focus = req.body?.focus && typeof req.body.focus === 'object' ? req.body.focus : {};
    const payload = {
        student_profile: studentProfile,
        profile_evidence: buildProfileEvidence(studentProfile),
        focus: {
            title: text(focus.title, 300),
            type: text(focus.type, 100),
            key: text(focus.key, 100),
            role: text(focus.role, 300),
            interview_mode: text(focus.interviewMode, 100),
            score: Number.isFinite(Number(focus.score)) ? Number(focus.score) : null,
            question: text(focus.question, 2000),
            answer: text(focus.answer, 5000),
            improvement: text(focus.improvement, 1000),
            requirement: text(focus.requirement, 500)
        },
        job_description: text(req.body?.job_description, 12000),
        recent_questions: stringList(req.body?.recent_questions, 10, 2000)
    };

    try {
        const result = await createStructuredResponse(
            'practice_question',
            practiceQuestionSchema,
            `Create one fresh interview practice question for the selected practice category. The UI categories
are intro, role_fit, cv, behavioral, technical, and closing. Do not simply re-ask an old interview question.
Use the role, job_description, student_profile, and profile_evidence to tailor the question to the kind of
job the candidate has been practicing for. recent_questions are only there so you can avoid repeating them.

Category behavior:
- intro: short "tell me about yourself" / background pitch connected to the role.
- role_fit: why this role, why this company/team type, strongest fit evidence, or fit risks.
- cv: projects, education, skills, experience, or CV claims a real interviewer would probe.
- behavioral: teamwork, conflict, pressure, failure, leadership, learning, or communication.
- technical: job-specific skill depth, process, trade-offs, tools, or problem-solving.
- closing: final fit answer, candidate questions, salary/availability style closing, or next-step readiness.

The question must feel like a human interviewer, be specific, and be answerable in 1-2 minutes. Use
profile_evidence when useful, but never invent details. Keep target_fix under 14 words. source should be
the category or role in under 8 words.`,
            payload
        );
        res.json(result);
    } catch (error) {
        console.error('OpenAI practice-question error:', error.message);
        res.status(502).json({ error: 'Could not generate a practice question.' });
    }
});

app.post('/api/practice-feedback', requireOpenAI, async (req, res) => {
    const payload = {
        focus: {
            title: text(req.body?.focus?.title, 300),
            improvement: text(req.body?.focus?.improvement, 1000),
            score: Number.isFinite(Number(req.body?.focus?.score)) ? Number(req.body.focus.score) : null
        },
        practice_question: text(req.body?.practice_question, 2000),
        answer: text(req.body?.answer, 8000),
        student_profile: normalizeProfile(req.body?.student_profile),
        job_description: text(req.body?.job_description, 12000)
    };
    if (!payload.practice_question || !payload.answer) {
        return res.status(400).json({ error: 'practice_question and answer are required.' });
    }

    try {
        const result = await createStructuredResponse(
            'practice_feedback',
            practiceFeedbackSchema,
            `Score this practice answer as an interview coach. Be direct, short, and useful. The user wants
minimal text. Return one concrete strength, one concrete fix, and one next_try instruction. Reward specific
examples, personal action, relevance to the question, and outcomes. Penalize vague answers and missing impact.
Each text field should be one sentence under 18 words.`,
            payload
        );
        res.json(result);
    } catch (error) {
        console.error('OpenAI practice-feedback error:', error.message);
        res.status(502).json({ error: 'Could not analyze the practice answer.' });
    }
});

app.post('/api/parse-cv', requireOpenAI, async (req, res) => {
    const cvText = text(req.body?.cv_text, 60000);
    if (cvText.length < 40) {
        return res.status(400).json({ error: 'The CV text is too short to parse.' });
    }

    try {
        const result = await createStructuredResponse(
            'parsed_cv',
            cvSchema,
            `You extract factual information from CV/resume text in English, Arabic, or Hebrew.
Return only data explicitly supported by the supplied text. Never infer or invent dates, degrees,
institutions, employers, job titles, projects, skills, locations, or contact details. Preserve the
original language and meaning. Keep small fields concise. Separate employment from personal or
academic projects, and courses from skills. Categorize skills only when the category is clear;
otherwise use skills.other. Keep descriptions factual and concise rather than copying whole sections.
Use empty strings and empty arrays for absent information. List absent important fields in
missingFields. Confidence describes the extraction evidence, not writing quality.`,
            { cv_text: cvText }
        );
        if (process.env.NODE_ENV !== 'production') console.log('CV parsed into strict JSON.');
        res.json(result);
    } catch (error) {
        console.error('OpenAI CV parsing error:', error.message);
        res.status(502).json({ error: 'We could not parse this CV. You can paste the text or edit your profile manually.' });
    }
});

app.post('/api/final-report', async (req, res) => {
    const transcript = normalizeReviewsTranscript(req.body?.full_interview_transcript);
    const skippedQuestions = normalizeSkippedQuestions(req.body?.skipped_questions);
    if (!transcript.length && !skippedQuestions.length) {
        return res.status(400).json({ error: 'At least one answered or skipped question is required.' });
    }

    const rubricReport = buildRubricReport(transcript, skippedQuestions, {
        interviewType: text(req.body?.interview_type, 100),
        interviewLength: req.body?.interview_length === 'full' ? 'full' : 'short',
        jobDescription: text(req.body?.job_description, 12000),
        studentProfile: normalizeProfile(req.body?.student_profile)
    });

    if (!openai) {
        return res.json(rubricReport);
    }

    try {
        const result = await createStructuredResponse(
            'interview_final_report',
            finalReportSchema,
            `You are a strict, realistic interview assessor. Review every answered question separately and
return one question_review for every answered transcript item, in the same order. Skipped questions are
provided separately: never score them, never include them in question_reviews, and never lower the overall
or dimension scores because of them. Use the full 1-10 range for answered questions: 1-3 for irrelevant or
extremely weak answers; 4-5 for vague, short, generic, or weakly supported answers;
6-7 for relevant answers with useful detail but clear gaps; 8-9 for specific, well-structured, job-relevant
answers with credible examples and outcomes; and 10 only for an exceptional answer with precise evidence,
excellent structure, strong judgment, and direct role relevance. Do not cluster scores around 8. The overall
score must reflect answered-question scores only. If there are no answered questions, return 0 for the overall
and all dimension scores and explain that there was insufficient evidence. Make feedback candid, specific,
constructive, and actionable.
Provide exactly three strengths, three improvements, and three action-plan items. Score communication
clarity, answer structure, role relevance, evidence and impact, and technical depth separately. Technical
depth should reflect the level expected for this interview; for nontechnical interviews, rate the depth of
role knowledge rather than inventing a technical requirement. List only concrete knowledge gaps supported
by the transcript, or return an empty array. Explain briefly how the evidence led to the overall score and
finish with a direct readiness recommendation. Compare the answered questions with the supplied job
description and return job requirements that were demonstrated and requirements that need more practice.
Recommend realistic questions to practice again, including useful versions of skipped questions.`,
            {
                full_interview_transcript: transcript,
                skipped_questions: skippedQuestions,
                interview_type: text(req.body?.interview_type, 100),
                interview_length: req.body?.interview_length === 'full' ? 'full' : 'short',
                job_description: text(req.body?.job_description, 12000),
                student_profile: normalizeProfile(req.body?.student_profile)
            }
        );
        const merged = {
            ...result,
            ...rubricReport,
            question_reviews: rubricReport.question_reviews.length ? rubricReport.question_reviews : result.question_reviews,
            strengths: rubricReport.strengths.length ? rubricReport.strengths : result.strengths,
            improvements: rubricReport.improvements.length ? rubricReport.improvements : result.improvements,
            action_plan: rubricReport.action_plan.length ? rubricReport.action_plan : result.action_plan,
            technical_gaps: rubricReport.technical_gaps.length ? rubricReport.technical_gaps : result.technical_gaps,
            job_requirements_covered: rubricReport.job_requirements_covered.length ? rubricReport.job_requirements_covered : result.job_requirements_covered,
            job_requirements_to_practice: rubricReport.job_requirements_to_practice.length ? rubricReport.job_requirements_to_practice : result.job_requirements_to_practice,
            recommended_practice_questions: rubricReport.recommended_practice_questions.length ? rubricReport.recommended_practice_questions : result.recommended_practice_questions,
            scoring_summary: rubricReport.scoring_summary || result.scoring_summary,
            final_recommendation: rubricReport.final_recommendation || result.final_recommendation,
            overall_score: rubricReport.overall_score,
            top_strength: rubricReport.top_strength,
            main_improvement: rubricReport.main_improvement,
            dimension_scores: rubricReport.dimension_scores
        };
        res.json(merged);
    } catch (error) {
        console.error('OpenAI final-report error:', error.message);
        res.json(rubricReport);
    }
});

app.get('/api/config', (_req, res) => {
    res.json(publicRuntimeConfig);
});

app.use(express.static(publicDir, { dotfiles: 'deny' }));

app.get('/', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((error, _req, res, _next) => {
    if (error instanceof SyntaxError) {
        return res.status(400).json({ error: 'Invalid JSON request body.' });
    }
    console.error('Server error:', error.message);
    res.status(500).json({ error: 'Unexpected server error.' });
});

if (require.main === module) {
    app.listen(port, host, () => {
        console.log(`PrepWise is running at http://${host}:${port}`);
        if (!openai) console.warn('OPENAI_API_KEY is missing. Add it to .env before using AI endpoints.');
    });
}

module.exports = app;
