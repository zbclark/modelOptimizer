/**
 * Weight Templates for Tournament Analysis
 * Extracted from Golf_Algorithm_Library/utilities/templateLoader.js
 * 
 * These represent POWER, BALANCED, and TECHNICAL course weight profiles
 */

const WEIGHT_TEMPLATES = {
  POWER: {
    name: "POWER",
    description: "Data-driven weights for distance-heavy courses (HIGH Distance correlation: 0.37)",
    groupWeights: {
      "Driving Performance": 0.130,
      "Approach - Short (<100)": 0.145,
      "Approach - Mid (100-150)": 0.180,
      "Approach - Long (150-200)": 0.150,
      "Approach - Very Long (>200)": 0.030,
      "Putting": 0.120,
      "Around the Green": 0.080,
      "Scoring": 0.110,
      "Course Management": 0.055
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.404 },
        "Driving Accuracy": { weight: 0.123 },
        "SG OTT": { weight: 0.472 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.14 },
        "Approach <100 SG": { weight: 0.33 },
        "Approach <100 Prox": { weight: 0.53 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.12 },
        "Approach <150 FW SG": { weight: 0.32 },
        "Approach <150 FW Prox": { weight: 0.56 },
        "Approach <150 Rough GIR": { weight: 0.12 },
        "Approach <150 Rough SG": { weight: 0.32 },
        "Approach <150 Rough Prox": { weight: 0.56 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.11 },
        "Approach <200 FW SG": { weight: 0.30 },
        "Approach <200 FW Prox": { weight: 0.59 },
        "Approach >150 Rough GIR": { weight: 0.11 },
        "Approach >150 Rough SG": { weight: 0.30 },
        "Approach >150 Rough Prox": { weight: 0.59 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.10 },
        "Approach >200 FW SG": { weight: 0.25 },
        "Approach >200 FW Prox": { weight: 0.65 }
      },
      "Putting": {
        "SG Putting": { weight: 1.0 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1.0 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.20 },
        "Scoring Average": { weight: 0.10 },
        "Birdie Chances Created": { weight: 0.10 },
        "Scoring: Approach <100 SG": { weight: 0.15 },
        "Scoring: Approach <150 FW SG": { weight: 0.15 },
        "Scoring: Approach <150 Rough SG": { weight: 0.15 },
        "Scoring: Approach <200 FW SG": { weight: 0.05 },
        "Scoring: Approach >200 FW SG": { weight: 0.00 },
        "Scoring: Approach >150 Rough SG": { weight: 0.10 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.12 },
        "Great Shots": { weight: 0.08 },
        "Poor Shot Avoidance": { weight: 0.08 },
        "Course Management: Approach <100 Prox": { weight: 0.10 },
        "Course Management: Approach <150 FW Prox": { weight: 0.10 },
        "Course Management: Approach <150 Rough Prox": { weight: 0.15 },
        "Course Management: Approach >150 Rough Prox": { weight: 0.20 },
        "Course Management: Approach <200 FW Prox": { weight: 0.12 },
        "Course Management: Approach >200 FW Prox": { weight: 0.05 }
      }
    }
  },  
  PGA_NATIONAL_RESORT_CHAMPION_COURSE: {
    name: "PGA_NATIONAL_RESORT_CHAMPION_COURSE",
    eventId: "10",
    description: "Cognizant Classic 2026 Pre-Event Blended",
    groupWeights: {
      "Driving Performance": 0.13061830677706968,
      "Approach - Short (<100)": 0.03967325412221145,
      "Approach - Mid (100-150)": 0.09623241998060136,
      "Approach - Long (150-200)": 0.1012518186226964,
      "Approach - Very Long (>200)": 0.05207626091173617,
      "Putting": 0.11215650484656241,
      "Around the Green": 0.048760895885741555,
      "Scoring": 0.20959345461956788,
      "Course Management": 0.20963708423381314
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.2523726894092997 },
        "Driving Accuracy": { weight: 0.30400961814640753 },
        "SG OTT": { weight: 0.4436176924442928 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.12888443362451668 },
        "Approach <100 SG": { weight: 0.09351281684089932 },
        "Approach <100 Prox": { weight: 0.777602749534584 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.11734028683181223 },
        "Approach <150 FW SG": { weight: 0.19335071707953058 },
        "Approach <150 FW Prox": { weight: 0.689308996088657 },
        "Approach <150 Rough GIR": { weight: 0 },
        "Approach <150 Rough SG": { weight: 0 },
        "Approach <150 Rough Prox": { weight: 0 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.10435349747268871 },
        "Approach <200 FW SG": { weight: 0.32773520300016307 },
        "Approach <200 FW Prox": { weight: 0.5679112995271481 },
        "Approach >150 Rough GIR": { weight: 0 },
        "Approach >150 Rough SG": { weight: 0 },
        "Approach >150 Rough Prox": { weight: 0 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.09394081728511038 },
        "Approach >200 FW SG": { weight: 0.15089243776420855 },
        "Approach >200 FW Prox": { weight: 0.755166744950681 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.7450259295033682 },
        "Scoring Average": { weight: 0.007938939594864166 },
        "Birdie Chances Created": { weight: 0.11022600134258224 },
        "Scoring: Approach <100 SG": { weight: 0.009029402550906245 },
        "Scoring: Approach <150 FW SG": { weight: 0.01956370552696353 },
        "Scoring: Approach <150 Rough SG": { weight: 0.01956370552696353 },
        "Scoring: Approach <200 FW SG": { weight: 0.05595493398970688 },
        "Scoring: Approach >200 FW SG": { weight: 0.01634869098232267 },
        "Scoring: Approach >150 Rough SG": { weight: 0.01634869098232267 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.32903378444648157 },
        "Great Shots": { weight: 0.07335495663315027 },
        "Poor Shot Avoidance": { weight: 0.13561301223439726 },
        "Course Management: Approach <100 Prox": { weight: 0.03049188428127408 },
        "Course Management: Approach <150 FW Prox": { weight: 0.06606574927609384 },
        "Course Management: Approach <150 Rough Prox": { weight: 0.06606574927609384 },
        "Course Management: Approach >150 Rough Prox": { weight: 0.055208790478973514 },
        "Course Management: Approach <200 FW Prox": { weight: 0.18895728289456207 },
        "Course Management: Approach >200 FW Prox": { weight: 0.055208790478973514 }
      }
    }
  },
  TECHNICAL: {
    name: "TECHNICAL",
    description: "Validation CSV TECHNICAL template (Weight_Templates.csv)",
    groupWeights: {
      "Driving Performance": 0.18021944606340115,
      "Approach - Short (<100)": 0.044839469883181715,
      "Approach - Mid (100-150)": 0.10037250082355624,
      "Approach - Long (150-200)": 0.1436028685097433,
      "Approach - Very Long (>200)": 0.048159035045485646,
      "Putting": 0.04983148772267694,
      "Around the Green": 0.02582165572815042,
      "Scoring": 0.23204013886425262,
      "Course Management": 0.17511339735955198
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.4386 },
        "Driving Accuracy": { weight: 0.3715 },
        "SG OTT": { weight: 0.1899 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.644035596440356 },
        "Approach <100 SG": { weight: 0.2873712628737126 },
        "Approach <100 Prox": { weight: 0.0685931406859314 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.25172517251725174 },
        "Approach <150 FW SG": { weight: 0.16611661166116612 },
        "Approach <150 FW Prox": { weight: 0.04150415041504151 },
        "Approach <150 Rough GIR": { weight: 0.24632463246324635 },
        "Approach <150 Rough SG": { weight: 0.19181918191819183 },
        "Approach <150 Rough Prox": { weight: 0.10251025102510251 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.24280000000000002 },
        "Approach <200 FW SG": { weight: 0.16620000000000001 },
        "Approach <200 FW Prox": { weight: 0.07590000000000001 },
        "Approach >150 Rough GIR": { weight: 0.20800000000000002 },
        "Approach >150 Rough SG": { weight: 0.13850000000000004 },
        "Approach >150 Rough Prox": { weight: 0.16860000000000003 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.19071907190719073 },
        "Approach >200 FW SG": { weight: 0.27502750275027504 },
        "Approach >200 FW Prox": { weight: 0.5342534253425343 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.2927 },
        "Scoring Average": { weight: 0.1994 },
        "Birdie Chances Created": { weight: 0.1446 },
        "Scoring: Approach <100 SG": { weight: 0.0727 },
        "Scoring: Approach <150 FW SG": { weight: 0.0663 },
        "Scoring: Approach <150 Rough SG": { weight: 0.0445 },
        "Scoring: Approach <200 FW SG": { weight: 0.0088 },
        "Scoring: Approach >200 FW SG": { weight: 0.0755 },
        "Scoring: Approach >150 Rough SG": { weight: 0.0955 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.1952 },
        "Great Shots": { weight: 0.0832 },
        "Poor Shot Avoidance": { weight: 0.3719503145495917 },
        "Course Management: Approach <100 Prox": { weight: 0.0326 },
        "Course Management: Approach <150 FW Prox": { weight: 0.0417 },
        "Course Management: Approach <150 Rough Prox": { weight: 0.1003 },
        "Course Management: Approach >150 Rough Prox": { weight: 0.1517 },
        "Course Management: Approach <200 FW Prox": { weight: 0.1231 },
        "Course Management: Approach >200 FW Prox": { weight: 0.091 }
      }
    }
  }, 
  BALANCED: {
    name: "BALANCED",
    description: "Data-driven weights for balanced courses (Accuracy: 0.35, SG Approach: 0.56)",
    groupWeights: {
      "Driving Performance": 0.090,
      "Approach - Short (<100)": 0.148,
      "Approach - Mid (100-150)": 0.190,
      "Approach - Long (150-200)": 0.160,
      "Approach - Very Long (>200)": 0.035,
      "Putting": 0.115,
      "Around the Green": 0.100,
      "Scoring": 0.105,
      "Course Management": 0.057
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.061 },
        "Driving Accuracy": { weight: 0.410 },
        "SG OTT": { weight: 0.529 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.12 },
        "Approach <100 SG": { weight: 0.34 },
        "Approach <100 Prox": { weight: 0.54 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.10 },
        "Approach <150 FW SG": { weight: 0.30 },
        "Approach <150 FW Prox": { weight: 0.60 },
        "Approach <150 Rough GIR": { weight: 0.10 },
        "Approach <150 Rough SG": { weight: 0.30 },
        "Approach <150 Rough Prox": { weight: 0.60 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.09 },
        "Approach <200 FW SG": { weight: 0.28 },
        "Approach <200 FW Prox": { weight: 0.63 },
        "Approach >150 Rough GIR": { weight: 0.09 },
        "Approach >150 Rough SG": { weight: 0.28 },
        "Approach >150 Rough Prox": { weight: 0.63 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.09 },
        "Approach >200 FW SG": { weight: 0.24 },
        "Approach >200 FW Prox": { weight: 0.67 }
      },
      "Putting": {
        "SG Putting": { weight: 1.0 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1.0 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.19 },
        "Scoring Average": { weight: 0.11 },
        "Birdie Chances Created": { weight: 0.10 },
        "Scoring: Approach <100 SG": { weight: 0.15 },
        "Scoring: Approach <150 FW SG": { weight: 0.15 },
        "Scoring: Approach <150 Rough SG": { weight: 0.15 },
        "Scoring: Approach <200 FW SG": { weight: 0.07 },
        "Scoring: Approach >200 FW SG": { weight: 0.03 },
        "Scoring: Approach >150 Rough SG": { weight: 0.05 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.12 },
        "Great Shots": { weight: 0.08 },
        "Poor Shot Avoidance": { weight: 0.08 },
        "Course Management: Approach <100 Prox": { weight: 0.12 },
        "Course Management: Approach <150 FW Prox": { weight: 0.12 },
        "Course Management: Approach <150 Rough Prox": { weight: 0.16 },
        "Course Management: Approach >150 Rough Prox": { weight: 0.18 },
        "Course Management: Approach <200 FW Prox": { weight: 0.11 },
        "Course Management: Approach >200 FW Prox": { weight: 0.03 }
      }
    }
  },
  TPC_LOUISIANA: {
    name: "TPC_LOUISIANA",
    eventId: "18",
    description: "Zurich Classic template from provided raw metric weights",
    groupWeights: {
      "Driving Performance": 0.090,
      "Approach - Short (<100)": 0.148,
      "Approach - Mid (100-150)": 0.190,
      "Approach - Long (150-200)": 0.160,
      "Approach - Very Long (>200)": 0.035,
      "Putting": 0.115,
      "Around the Green": 0.100,
      "Scoring": 0.105,
      "Course Management": 0.057
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.35 },
        "Driving Accuracy": { weight: 0.3 },
        "SG OTT": { weight: 0.35 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.3 },
        "Approach <100 SG": { weight: 0.4 },
        "Approach <100 Prox": { weight: 0.3 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.3 },
        "Approach <150 FW SG": { weight: 0.45 },
        "Approach <150 FW Prox": { weight: 0.25 },
        "Approach <150 Rough GIR": { weight: 0.3 },
        "Approach <150 Rough SG": { weight: 0.45 },
        "Approach <150 Rough Prox": { weight: 0.25 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.3 },
        "Approach <200 FW SG": { weight: 0.45 },
        "Approach <200 FW Prox": { weight: 0.25 },
        "Approach >150 Rough GIR": { weight: 0.3 },
        "Approach >150 Rough SG": { weight: 0.45 },
        "Approach >150 Rough Prox": { weight: 0.25 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.3 },
        "Approach >200 FW SG": { weight: 0.45 },
        "Approach >200 FW Prox": { weight: 0.25 }
      },
      "Putting": {
        "SG Putting": { weight: 1.0 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1.0 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.0 },
        "Scoring Average": { weight: 0.15 },
        "Birdie Chances Created": { weight: 0.35 },
        "Scoring: Approach <100 SG": { weight: 0.07 },
        "Scoring: Approach <150 FW SG": { weight: 0.10 },
        "Scoring: Approach <150 Rough SG": { weight: 0.08 },
        "Scoring: Approach >150 Rough SG": { weight: 0.07 },
        "Scoring: Approach <200 FW SG": { weight: 0.10 },
        "Scoring: Approach >200 FW SG": { weight: 0.08 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.25 },
        "Great Shots": { weight: 0.15 },
        "Poor Shot Avoidance": { weight: 0.2 },
        "Course Management: Approach <100 Prox": { weight: 0.07 },
        "Course Management: Approach <150 FW Prox": { weight: 0.09 },
        "Course Management: Approach <150 Rough Prox": { weight: 0.06 },
        "Course Management: Approach >150 Rough Prox": { weight: 0.05 },
        "Course Management: Approach <200 FW Prox": { weight: 0.08 },
        "Course Management: Approach >200 FW Prox": { weight: 0.05 }
      }
    }
  },
  PEBBLE_BEACH_GOLF_LINKS: {
    name: "PEBBLE_BEACH_GOLF_LINKS",
    eventId: "5",
    description: "ATT Pebble Beach 2026 Optimized: 0.2966 corr, 50.0% Top-20, 51.1% Top-20 Weighted",
    groupWeights: {
      "Driving Performance": 0.10674619569643001,
      "Approach - Short (<100)": 0.12432562408193541,
      "Approach - Mid (100-150)": 0.20171598369561888,
      "Approach - Long (150-200)": 0.11747182033016913,
      "Approach - Very Long (>200)": 0.03105699014772621,
      "Putting": 0.1034256370013901,
      "Around the Green": 0.09756582753955498,
      "Scoring": 0.1584101824516098,
      "Course Management": 0.059281739055565434
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.1803877236425231 },
        "Driving Accuracy": { weight: 0.3836054863808967 },
        "SG OTT": { weight: 0.43600678997658027 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.07853507225935451 },
        "Approach <100 SG": { weight: 0.2823498400385536 },
        "Approach <100 Prox": { weight: 0.6391150877020918 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.04632168767668801 },
        "Approach <150 FW SG": { weight: 0.15372497590082956 },
        "Approach <150 FW Prox": { weight: 0.307371857686299 },
        "Approach <150 Rough GIR": { weight: 0.037920236352637554 },
        "Approach <150 Rough SG": { weight: 0.14210773708127672 },
        "Approach <150 Rough Prox": { weight: -0.3125535053022692 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.038655797252677836 },
        "Approach <200 FW SG": { weight: 0.12936596994634195 },
        "Approach <200 FW Prox": { weight: 0.3527610670068222 },
        "Approach >150 Rough GIR": { weight: 0.03873127292748768 },
        "Approach >150 Rough SG": { weight: 0.14763354558278372 },
        "Approach >150 Rough Prox": { weight: -0.2928523472838866 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.07146206119774032 },
        "Approach >200 FW SG": { weight: 0.2521555010819336 },
        "Approach >200 FW Prox": { weight: 0.6763824377203261 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.21382267529343155 },
        "Scoring Average": { weight: 0.19034024965689933 },
        "Birdie Chances Created": { weight: 0.04401450236458315 },
        "Scoring: Approach <100 SG": { weight: 0.053793752612453456 },
        "Scoring: Approach <150 FW SG": { weight: 0.10173480452296041 },
        "Scoring: Approach <150 Rough SG": { weight: 0.08438109715216803 },
        "Scoring: Approach <200 FW SG": { weight: 0.176128696600687 },
        "Scoring: Approach >200 FW SG": { weight: 0.06915499237709209 },
        "Scoring: Approach >150 Rough SG": { weight: 0.06662922941972486 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.364441958178438 },
        "Great Shots": { weight: 0.14495792039380806 },
        "Poor Shot Avoidance": { weight: -0.15429194214265352 },
        "Course Management: Approach <100 Prox": { weight: 0.048415150468639735 },
        "Course Management: Approach <150 FW Prox": { weight: 0.07246081564708991 },
        "Course Management: Approach <150 Rough Prox": { weight: -0.08180176381823198 },
        "Course Management: Approach >150 Rough Prox": { weight: -0.0675769839244237 },
        "Course Management: Approach <200 FW Prox": { weight: 0.15442275194536878 },
        "Course Management: Approach >200 FW Prox": { weight: 0.06581459776665337 }
      }
    }
  },
  WAIALAE_COUNTRY_CLUB: {
    name: "WAIALAE_COUNTRY_CLUB",
    eventId: "6",
    description: "Sony Open 2026 Optimized: 0.4896 corr, 6.4% Top-20, 7.3% Top-20 Weighted",
    groupWeights: {
      "Driving Performance": 0.14221547712535823,
      "Approach - Short (<100)": 0.14223367573656825,
      "Approach - Mid (100-150)": 0.1585070053307613,
      "Approach - Long (150-200)": 0.1471382852447258,
      "Approach - Very Long (>200)": 0.02942765704894516,
      "Putting": 0.14015203361392248,
      "Around the Green": 0.07847375213052042,
      "Scoring": 0.10790140917946558,
      "Course Management": 0.05395070458973279
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.4439213937297278 },
        "Driving Accuracy": { weight: 0.10452536855202589 },
        "SG OTT": { weight: 0.45155323771824624 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.12704935482846694 },
        "Approach <100 SG": { weight: 0.3439453170521983 },
        "Approach <100 Prox": { weight: -0.5290053281193348 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.061009317754322216 },
        "Approach <150 FW SG": { weight: 0.1647364944519474 },
        "Approach <150 FW Prox": { weight: -0.3032646295934103 },
        "Approach <150 Rough GIR": { weight: 0.06366492684648313 },
        "Approach <150 Rough SG": { weight: 0.15126210442130167 },
        "Approach <150 Rough Prox": { weight: -0.25606252693253534 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.058875045115195625 },
        "Approach <200 FW SG": { weight: 0.15107854596009665 },
        "Approach <200 FW Prox": { weight: -0.29321927092225336 },
        "Approach >150 Rough GIR": { weight: 0.053690945491580384 },
        "Approach >150 Rough SG": { weight: 0.1428106531715783 },
        "Approach >150 Rough Prox": { weight: -0.30032553933929573 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.08980228691878112 },
        "Approach >200 FW SG": { weight: 0.2624094451995176 },
        "Approach >200 FW Prox": { weight: -0.6477882678817013 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.1947674504535388 },
        "Scoring Average": { weight: -0.09468975965994297 },
        "Birdie Chances Created": { weight: 0.09881839144013035 },
        "Scoring: Approach <100 SG": { weight: 0.16398981034606624 },
        "Scoring: Approach <150 FW SG": { weight: 0.14839301873369026 },
        "Scoring: Approach <150 Rough SG": { weight: 0.14399947925214288 },
        "Scoring: Approach <200 FW SG": { weight: 0.05187189593106295 },
        "Scoring: Approach >200 FW SG": { weight: 0.0000955570911835887 },
        "Scoring: Approach >150 Rough SG": { weight: 0.10337463709224189 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.11502369101039253 },
        "Great Shots": { weight: 0.09022106664922576 },
        "Poor Shot Avoidance": { weight: -0.07429961681411379 },
        "Course Management: Approach <100 Prox": { weight: -0.10783374148021413 },
        "Course Management: Approach <150 FW Prox": { weight: -0.10556394634166712 },
        "Course Management: Approach <150 Rough Prox": { weight: -0.16433815048123793 },
        "Course Management: Approach >150 Rough Prox": { weight: -0.17586640960416564 },
        "Course Management: Approach <200 FW Prox": { weight: -0.12204491100887761 },
        "Course Management: Approach >200 FW Prox": { weight: -0.044808466610105416 }
      }
    }
  },
  THE_RIVIERA_COUNTRY_CLUB: {
    name: "THE_RIVIERA_COUNTRY_CLUB",
    eventId: "7",
    description: "Genesis Invitational 2026 Optimized: 0.6418 corr, 65.0% Top-20, 72.4% Top-20 Weighted",
    groupWeights: {
      "Driving Performance": 0.14491401069595441,
      "Approach - Short (<100)": 0.14493255462515853,
      "Approach - Mid (100-150)": 0.14126346877427762,
      "Approach - Long (150-200)": 0.12318067661640782,
      "Approach - Very Long (>200)": 0.02998604578451556,
      "Putting": 0.17083720293014232,
      "Around the Green": 0.07996278875870816,
      "Scoring": 0.10994883454322371,
      "Course Management": 0.054974417271611856
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.5121256291951152 },
        "Driving Accuracy": { weight: 0.09293882047578655 },
        "SG OTT": { weight: 0.39493555032909816 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.2625572329653397 },
        "Approach <100 SG": { weight: 0.7372450888294415 },
        "Approach <100 Prox": { weight: 0.00019767820521883359 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.15936071336747104 },
        "Approach <150 FW SG": { weight: 0.3593671285754248 },
        "Approach <150 FW Prox": { weight: 0.00023697051816604892 },
        "Approach <150 Rough GIR": { weight: 0.15789928742890777 },
        "Approach <150 Rough SG": { weight: 0.3228989295918644 },
        "Approach <150 Rough Prox": { weight: 0.00023697051816604892 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.13142478679999592 },
        "Approach <200 FW SG": { weight: 0.388725559496779 },
        "Approach <200 FW Prox": { weight: 0.0002563771341928853 },
        "Approach >150 Rough GIR": { weight: 0.13380444612429132 },
        "Approach >150 Rough SG": { weight: 0.345532453310548 },
        "Approach >150 Rough Prox": { weight: -0.0002563771341928853 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.2197010793735438 },
        "Approach >200 FW SG": { weight: 0.7800361356526654 },
        "Approach >200 FW Prox": { weight: 0.0002627849737908229 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.23074569266537626 },
        "Scoring Average": { weight: 0.00010824312848986641 },
        "Birdie Chances Created": { weight: 0.0933274578156979 },
        "Scoring: Approach <100 SG": { weight: 0.17643055860134577 },
        "Scoring: Approach <150 FW SG": { weight: 0.1695485759178827 },
        "Scoring: Approach <150 Rough SG": { weight: 0.1537034966494277 },
        "Scoring: Approach <200 FW SG": { weight: 0.0614716273448912 },
        "Scoring: Approach >200 FW SG": { weight: 0.00010824312848986641 },
        "Scoring: Approach >150 Rough SG": { weight: 0.11455610474839885 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.3663343336024537 },
        "Great Shots": { weight: 0.3100090948394791 },
        "Poor Shot Avoidance": { weight: 0.2471999056539836 },
        "Course Management: Approach <100 Prox": { weight: 0.0003595081816616878 },
        "Course Management: Approach <150 FW Prox": { weight: 0.0003595081816616878 },
        "Course Management: Approach <150 Rough Prox": { weight: 0.0003595081816616878 },
        "Course Management: Approach >150 Rough Prox": { weight: -0.0003595081816616878 },
        "Course Management: Approach <200 FW Prox": { weight: 0.0003595081816616878 },
        "Course Management: Approach >200 FW Prox": { weight: 0.0003595081816616878 }
      }
    }
  },
  PETE_DYE_STADIUM_COURSE: {
    name: "PETE_DYE_STADIUM_COURSE",
    eventId: "2",
    description: "American Express 2026 Optimized: 0.8272 corr, 60.0% Top-20, 70.8% Top-20 Weighted",
    groupWeights: {
      "Driving Performance": 0.1253131911339183,
      "Approach - Short (<100)": 0.038061908773678634,
      "Approach - Mid (100-150)": 0.09232390111204239,
      "Approach - Long (150-200)": 0.09713943483724766,
      "Approach - Very Long (>200)": 0.052687619599157735,
      "Putting": 0.10884765419724342,
      "Around the Green": 0.04678045227166973,
      "Scoring": 0.23772324926223903,
      "Course Management": 0.2011225888128031
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.27923808554329926 },
        "Driving Accuracy": { weight: 0.2936802262057306 },
        "SG OTT": { weight: 0.4270816882509701 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.1284642840040011 },
        "Approach <100 SG": { weight: 0.08207670615053442 },
        "Approach <100 Prox": { weight: -0.7894590098454645 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.1262684554688367 },
        "Approach <150 FW SG": { weight: 0.19181023674027556 },
        "Approach <150 FW Prox": { weight: 0.681604078651498 },
        "Approach <150 Rough GIR": { weight: 0.00010574304646325831 },
        "Approach <150 Rough SG": { weight: 0.00010574304646325831 },
        "Approach <150 Rough Prox": { weight: -0.00010574304646325831 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.11720580542183769 },
        "Approach <200 FW SG": { weight: 0.35405375523227467 },
        "Approach <200 FW Prox": { weight: 0.5284130271688414 },
        "Approach >150 Rough GIR": { weight: 0.00010913739234877063 },
        "Approach >150 Rough SG": { weight: 0.00010913739234877063 },
        "Approach >150 Rough Prox": { weight: -0.00010913739234877063 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.11296129416014204 },
        "Approach >200 FW SG": { weight: 0.17517432657899157 },
        "Approach >200 FW Prox": { weight: -0.7118643792608664 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.7655709758222491 },
        "Scoring Average": { weight: 0.007996325976291628 },
        "Birdie Chances Created": { weight: 0.09163537167074406 },
        "Scoring: Approach <100 SG": { weight: 0.008842514217185474 },
        "Scoring: Approach <150 FW SG": { weight: 0.017359903870478935 },
        "Scoring: Approach <150 Rough SG": { weight: 0.021512179838451863 },
        "Scoring: Approach <200 FW SG": { weight: 0.05542564628140196 },
        "Scoring: Approach >200 FW SG": { weight: 0.014360125375776923 },
        "Scoring: Approach >150 Rough SG": { weight: 0.017296956947420127 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.3738648846703404 },
        "Great Shots": { weight: 0.08278006608084369 },
        "Poor Shot Avoidance": { weight: 0.20992705977835463 },
        "Course Management: Approach <100 Prox": { weight: -0.030212644831939545 },
        "Course Management: Approach <150 FW Prox": { weight: 0.0699386316246899 },
        "Course Management: Approach <150 Rough Prox": { weight: -0.07517216176760337 },
        "Course Management: Approach >150 Rough Prox": { weight: -0.05296510860702875 },
        "Course Management: Approach <200 FW Prox": { weight: 0.18280075040093738 },
        "Course Management: Approach >200 FW Prox": { weight: -0.05795170447265951 }
      }
    }
  },
  TORREY_PINES_GOLF_COURSE: {
    name: "TORREY_PINES_GOLF_COURSE",
    eventId: "4",
    description: "Farmers 2026 Optimized: 0.8968 corr, 85.0% Top-20, 91.2% Top-20 Weighted",
    groupWeights: {
      "Driving Performance": 0.12660970239530023,
      "Approach - Short (<100)": 0.03845570365599098,
      "Approach - Mid (100-150)": 0.09327909965421785,
      "Approach - Long (150-200)": 0.08069236890192115,
      "Approach - Very Long (>200)": 0.05323273453500447,
      "Putting": 0.12956308680702602,
      "Around the Green": 0.04726445066508662,
      "Scoring": 0.24018277381006914,
      "Course Management": 0.1907200795753835
    },
    metricWeights: {
      "Driving Performance": {
        "Driving Distance": { weight: 0.31176799346270223 },
        "Driving Accuracy": { weight: 0.31964555231972197 },
        "SG OTT": { weight: 0.3685864542175758 }
      },
      "Approach - Short (<100)": {
        "Approach <100 GIR": { weight: 0.6036962474169806 },
        "Approach <100 SG": { weight: 0.39585520976128485 },
        "Approach <100 Prox": { weight: 0.0004485428217345848 }
      },
      "Approach - Mid (100-150)": {
        "Approach <150 FW GIR": { weight: 0.10705782084139466 },
        "Approach <150 FW SG": { weight: 0.1971588253591168 },
        "Approach <150 FW Prox": { weight: 0.6954900830682796 },
        "Approach <150 Rough GIR": { weight: 0.00009867208712271649 },
        "Approach <150 Rough SG": { weight: 0.00009729932204305113 },
        "Approach <150 Rough Prox": { weight: -0.00009729932204305113 }
      },
      "Approach - Long (150-200)": {
        "Approach <200 FW GIR": { weight: 0.12213861844559162 },
        "Approach <200 FW SG": { weight: 0.35239036142743935 },
        "Approach <200 FW Prox": { weight: 0.5251616090847234 },
        "Approach >150 Rough GIR": { weight: 0.00009842786400276938 },
        "Approach >150 Rough SG": { weight: 0.00011255531424005993 },
        "Approach >150 Rough Prox": { weight: -0.00009842786400276938 }
      },
      "Approach - Very Long (>200)": {
        "Approach >200 FW GIR": { weight: 0.3349991560344384 },
        "Approach >200 FW SG": { weight: 0.6646593942961323 },
        "Approach >200 FW Prox": { weight: 0.00034144966942937724 }
      },
      "Putting": {
        "SG Putting": { weight: 1 }
      },
      "Around the Green": {
        "SG Around Green": { weight: 1 }
      },
      "Scoring": {
        "SG T2G": { weight: 0.7826623799724027 },
        "Scoring Average": { weight: 0.007818311232344936 },
        "Birdie Chances Created": { weight: 0.07900675571673915 },
        "Scoring: Approach <100 SG": { weight: 0.007389830518636098 },
        "Scoring: Approach <150 FW SG": { weight: 0.016113217969961735 },
        "Scoring: Approach <150 Rough SG": { weight: 0.019173022165490886 },
        "Scoring: Approach <200 FW SG": { weight: 0.05867670947350347 },
        "Scoring: Approach >200 FW SG": { weight: 0.014092796345894009 },
        "Scoring: Approach >150 Rough SG": { weight: 0.015066976605027012 }
      },
      "Course Management": {
        "Scrambling": { weight: 0.4798787771341577 },
        "Great Shots": { weight: 0.10726773827572121 },
        "Poor Shot Avoidance": { weight: 0.10158100809932528 },
        "Course Management: Approach <100 Prox": { weight: 0.00012381627567870942 },
        "Course Management: Approach <150 FW Prox": { weight: 0.08407240502916724 },
        "Course Management: Approach <150 Rough Prox": { weight: -0.00012381627567870942 },
        "Course Management: Approach >150 Rough Prox": { weight: -0.00012381627567870942 },
        "Course Management: Approach <200 FW Prox": { weight: 0.21993976277920974 },
        "Course Management: Approach >200 FW Prox": { weight: 0.00012381627567870942 }
      }
    }
  }};

module.exports = { WEIGHT_TEMPLATES };
