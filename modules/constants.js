// modules/constants.js

export const CACHE_KEYS = {
    RELEASES_PREFIX: 'releases_',
    LAST_UPDATED_PREFIX: 'lastUpdated_',
    FAILED_QUEUE_PREFIX: 'failedQueue_',
    USER_SETTINGS: 'userSettings'
};

export const DISCOGS_BASE_URL = 'https://api.discogs.com';
export const TOKEN_PRESENT_DELAY_MS = 1100;
export const NO_TOKEN_DELAY_MS = 3000;
export const MAX_ADDITIONAL_VERSIONS_FOR_CREDITS = 5;
export const APP_VERSION = '0.2.1-alpha';

export const CREDIT_CATEGORIES = {
    production: {
        display: 'Production',
        priority: 1,
        standardRoles: ['Producer', 'Executive Producer', 'Co-Producer', 'Associate Producer', 'Additional Producer', 'Vocal Producer', 'Music Producer', 'Beat Producer', 'Track Producer'],
        summaryTerm: 'Produced'
    },
    engineering: {
        display: 'Engineering',
        priority: 2,
        standardRoles: ['Engineer', 'Recording Engineer', 'Audio Engineer', 'Sound Engineer', 'Assistant Engineer', 'Additional Engineer', 'Co-Engineer', 'Vocal Engineer', 'Tracking Engineer', 'Overdub Engineer', 'Live Engineer'],
        summaryTerm: 'Engineered'
    },
    mixing: {
        display: 'Mixing',
        priority: 3,
        standardRoles: ['Mixed', 'Co-Mixed', 'Assistant Mix', 'Additional Mix', 'Vocal Mix'],
        summaryTerm: 'Mixed'
    },
    mastering: {
        display: 'Mastering',
        priority: 4,
        standardRoles: ['Mastered', 'Remastered', 'Pre-Mastered', 'Co-Mastered', 'Assistant Mastering', 'Additional Mastering'],
        summaryTerm: 'Mastered'
    },
    vocals: {
        display: 'Vocals',
        priority: 5,
        standardRoles: ['Vocals', 'Lead Vocals', 'Backing Vocals', 'Harmony Vocals', 'Singer', 'Voice'],
        summaryTerm: 'Vocals'
    },
    instruments: {
        display: 'Instruments',
        priority: 6,
        standardRoles: ['Guitar', 'Electric Guitar', 'Acoustic Guitar', 'Bass', 'Bass Guitar', 'Electric Bass', 'Drums', 'Percussion', 'Piano', 'Keyboards', 'Synthesizer'],
        summaryTerm: 'Instruments'
    },
    performance: {
        display: 'Performance',
        priority: 7,
        standardRoles: ['Performer', 'Featured Artist', 'Guest Vocalist', 'Lead Performer', 'Solo', 'Soloist', 'Featuring', 'With', 'Appears Courtesy Of'],
        summaryTerm: 'Performed'
    },
    orchestral: {
        display: 'Orchestral',
        priority: 8,
        standardRoles: ['Conductor', 'Musical Director', 'Concertmaster', 'Orchestrator', 'String Leader', 'Section Leader', 'Principal', 'Orchestra', 'Ensemble', 'Choir', 'Chorus'],
        summaryTerm: 'Orchestral Work'
    },
    arrangement: {
        display: 'Arrangement',
        priority: 9,
        standardRoles: ['Arranger', 'String Arranger', 'Horn Arranger', 'Vocal Arranger', 'Orchestrator', 'Adapted By', 'Additional Arrangement'],
        summaryTerm: 'Arranged'
    },
    programming: {
        display: 'Programming',
        priority: 10,
        standardRoles: ['Programmer', 'Beat Programmer', 'Drum Programming', 'Synthesizer Programming', 'Sequencer', 'Sampler', 'Electronic Beats', 'Programming By'],
        summaryTerm: 'Programmed'
    },
    technical: {
        display: 'Technical',
        priority: 11,
        standardRoles: ['Assistant', 'Tape Operator', 'Digital Editing', 'Pro Tools Operator', 'Technical Assistant', 'Setup', 'Maintenance', 'Equipment'],
        summaryTerm: 'Technical Support'
    },
    remix: {
        display: 'Remix',
        priority: 12,
        standardRoles: ['Remix', 'Additional Production Remix'],
        summaryTerm: 'Remixed'
    },
    songwriting: {
        display: 'Songwriting',
        priority: 13,
        standardRoles: ['Writer', 'Composer', 'Lyricist', 'Music By', 'Words By'],
        summaryTerm: 'Written'
    },
    other: {
        display: 'Additional Credits',
        priority: 99,
        standardRoles: [],
        preserveOriginal: true,
        summaryTerm: 'Other Credits' // Or set to undefined/null if you want to omit 'Other' from this summary
    }
};

export const ABBREVIATION_MAP = {
    // Production
    'prod': 'producer', 'exec prod': 'executive producer', 'co-prod': 'co-producer',
    'add\'l prod': 'additional producer', 'assoc prod': 'associate producer',
    'exec. prod': 'executive producer', 'co prod': 'co-producer',
    
    // Engineering
    'eng': 'engineer', 'rec eng': 'recording engineer', 'mix eng': 'mixing engineer', // 'mix eng' could also be 'mix engineer'
    'mast eng': 'mastering engineer', 'asst eng': 'assistant engineer', 'add\'l eng': 'additional engineer',
    'recording eng': 'recording engineer', 'audio eng': 'audio engineer', 'sound eng': 'sound engineer',
    
    // Performance
    'voc': 'vocals', 'lead voc': 'lead vocals', 'bg voc': 'backing vocals',
    'bgv': 'backing vocals', 'harmony voc': 'harmony vocals',
    'gtr': 'guitar', 'elec gtr': 'electric guitar', 'ac gtr': 'acoustic guitar',
    'bass gtr': 'bass guitar', 'keys': 'keyboards', 'kbd': 'keyboards',
    'synt': 'synthesizer', 'synth': 'synthesizer', 'perc': 'percussion', 'drm': 'drums', 'dr': 'drums',
    
    // Additional Performance
    'feat': 'featuring', 'ft': 'featuring', 'w/': 'with', 'perf': 'performer',
    'guest': 'guest artist', 'lead perf': 'lead performer', 'sp guest': 'special guest',
    
    // Orchestral/Classical  
    'cond': 'conductor', 'orch': 'orchestrator', // Changed from 'orchestra' to 'orchestrator' for role context
    'str': 'strings', 'ens': 'ensemble', 'dir': 'director', 
    'mus dir': 'musical director', 'conc': 'concertmaster',
    
    // Arrangement
    'arr': 'arranger', 'str arr': 'string arranger', 'horn arr': 'horn arranger',
    'voc arr': 'vocal arranger',
    
    // Programming/Electronic
    'prog': 'programmer', 'program': 'programmer', 'seq': 'sequencer', 'samp': 'sampler', 
    'drum prog': 'drum programming', 'beat prog': 'beat programmer',
    
    // Technical
    'asst': 'assistant', 'tech': 'technical', 'op': 'operator', 
    'tape op': 'tape operator', 'pt op': 'pro tools operator',
    
    // Comprehensive Instruments
    'elec': 'electric', 'ac': 'acoustic', 'bs': 'bass', 'gt': 'guitar', 'gtrs': 'guitars',
    'pno': 'piano', 'org': 'organ', 'harp': 'harp', 'vln': 'violin',
    'vla': 'viola', 'vc': 'cello', 'cb': 'contrabass', 'fl': 'flute',
    'ob': 'oboe', 'cl': 'clarinet', 'sax': 'saxophone', 'tpt': 'trumpet',
    'tbn': 'trombone', 'hn': 'horn', 'tba': 'tuba',
    
    // Other
    'comp': 'composer', 'lyr': 'lyricist', 'rmx': 'remix', 'mix': 'mixed', 'mstr': 'mastered'
};