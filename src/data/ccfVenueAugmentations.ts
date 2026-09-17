/**
 * Augmented alias and canonical variant definitions for major CCF conferences and journals.
 * Keyed by official fullName or official abbr to guarantee disambiguation.
 */
export const ccfVenueAugmentations: Record<string, string[]> = {
  // --- Artificial Intelligence / Machine Learning / Computer Vision ---
  "Conference on Neural Information Processing Systems": [
    "Advances in Neural Information Processing Systems",
    "Adv Neural Inf Process Syst",
    "Adv. Neural Inf. Process. Syst.",
    "Neural Information Processing Systems",
    "NIPS",
    "Annual Conference on Neural Information Processing Systems",
    "International Conference on Neural Information Processing Systems",
  ],
  "International Conference on Machine Learning": [
    "Proceedings of Machine Learning Research",
    "Proc. Mach. Learn. Res.",
    "Proc Mach Learn Res",
    "PMLR",
    "International Conference on Machine Learning",
  ],
  "International Conference on Learning Representations": [
    "Int. Conf. Learn. Represent.",
    "Int Conf Learn Represent",
    "International Conference on Learning Representations",
  ],
  "IEEE/CVF Computer Vision and Pattern Recognition Conference": [
    "IEEE/CVF Conference on Computer Vision and Pattern Recognition",
    "IEEE Conference on Computer Vision and Pattern Recognition",
    "Computer Vision and Pattern Recognition",
    "IEEE Computer Society Conference on Computer Vision and Pattern Recognition",
    "Proc. IEEE Conf. Comput. Vis. Pattern Recognit.",
  ],
  "International Conference on Computer Vision": [
    "IEEE/CVF International Conference on Computer Vision",
    "IEEE International Conference on Computer Vision",
    "Proc. IEEE Int. Conf. Comput. Vis.",
  ],
  "European Conference on Computer Vision": [
    "Proc. Eur. Conf. Comput. Vis.",
    "European Conference on Computer Vision",
  ],
  "AAAI Conference on Artificial Intelligence": [
    "National Conference on Artificial Intelligence",
    "Proceedings of the AAAI Conference on Artificial Intelligence",
    "Proc. AAAI Conf. Artif. Intell.",
    "AAAI/IAAI",
  ],
  "International Joint Conference on Artificial Intelligence": [
    "IJCAI/ECAI",
    "IJCAI-ECAI",
    "International Joint Conference on Artificial Intelligence",
  ],
  "Annual Meeting of the Association for Computational Linguistics": [
    "Proceedings of the Annual Meeting of the Association for Computational Linguistics",
    "Association for Computational Linguistics",
  ],
  "Conference on Empirical Methods in Natural Language Processing": [
    "Empirical Methods in Natural Language Processing",
    "Proceedings of the Conference on Empirical Methods in Natural Language Processing",
  ],
  "North American Chapter of the Associationfor Computational Linguistics": [
    "Conference of the North American Chapter of the Association for Computational Linguistics",
    "North American Chapter of the Association for Computational Linguistics",
    "NAACL-HLT",
    "NAACL HLT",
  ],
  "International Conference on Computational Linguistics": [
    "Proceedings of the International Conference on Computational Linguistics",
  ],
  "ACM SIGKDD Conference on Knowledge Discovery and Data Mining": [
    "ACM SIGKDD International Conference on Knowledge Discovery and Data Mining",
    "Knowledge Discovery and Data Mining",
    "KDD",
    "SIGKDD",
  ],
  "International ACM SIGIR Conference on Research and Development in Information Retrieval": [
    "ACM SIGIR Conference on Research and Development in Information Retrieval",
    "Research and Development in Information Retrieval",
    "SIGIR Conference on Research and Development in Information Retrieval",
  ],
  "International World Wide Web Conference": [
    "The Web Conference",
    "The Web Conf",
    "World Wide Web Conference",
    "International World Wide Web Conference",
    "WWW",
  ],

  // --- Systems / Networks / Storage / Security ---
  "USENIX Symposium on Operating Systems Design and Implementation": [
    "Operating Systems Design and Implementation",
  ],
  "ACM Symposium on Operating Systems Principles": [
    "Operating Systems Principles",
  ],
  "USENIX Annual Technical Conference": [
    "USENIX ATC",
    "ACM SIGOPS ATC",
  ],
  "ACM SIGOPS ATC": [
    "USENIX Annual Technical Conference",
    "USENIX ATC",
  ],
  "USENIX Conference on File and Storage Technologies": [
    "File and Storage Technologies",
  ],
  "ACM SIGCOMM Conference": [
    "Conference on Applications, Technologies, Architectures, and Protocols for Computer Communication",
  ],
  "USENIX Symposium on Networked Systems Design and Implementation": [
    "Networked Systems Design and Implementation",
  ],
  "IEEE International Conference on Computer Communications": [
    "IEEE INFOCOM",
    "Computer Communications Conference",
  ],
  "IEEE Symposium on Security and Privacy": [
    "IEEE Symposium on Security & Privacy",
    "Symposium on Security and Privacy",
    "IEEE S&P",
    "S&P",
    "Oakland",
  ],
  "ACM Conference on Computer and Communications Security": [
    "Computer and Communications Security",
    "ACM CCS",
    "CCS",
  ],
  "USENIX Security Symposium": [
    "USENIX Security",
  ],
  "Network and Distributed System Security Symposium": [
    "Network and Distributed Systems Security",
  ],

  // --- Database / Data Engineering ---
  "ACM SIGMOD Conference": [
    "ACM SIGMOD International Conference on Management of Data",
    "Management of Data",
  ],
  "International Conference on Very Large Data Bases": [
    "Proceedings of the VLDB Endowment",
    "Proc. VLDB Endow.",
    "Proc VLDB Endow",
    "PVLDB",
  ],
  "IEEE International Conference on Data Engineering": [
    "Data Engineering",
    "IEEE ICDE",
  ],
  "ACM SIGMOD-SIGACT-SIGAI Symposium on Principles of Database Systems": [
    "Principles of Database Systems",
    "ACM Symposium on Principles of Database Systems",
  ],

  // --- Software Engineering / Programming Languages ---
  "ACM SIGPLAN Conference on Programming Language Design and Implementation": [
    "Programming Language Design and Implementation",
  ],
  "ACM SIGPLAN-SIGACT Symposium on Principles of Programming Languages": [
    "Principles of Programming Languages",
  ],
  "International Conference on Software Engineering": [
    "IEEE/ACM International Conference on Software Engineering",
  ],
  "ACM International Conference on the Foundations of Software Engineering": [
    "ACM Joint European Software Engineering Conference and Symposium on the Foundations of Software Engineering",
    "ESEC/FSE",
    "Foundations of Software Engineering",
  ],
  "International Conference on Automated Software Engineering": [
    "IEEE/ACM International Conference on Automated Software Engineering",
    "Automated Software Engineering",
  ],
  "ACM SIGSOFT International Symposium on Software Testing and Analysis": [
    "Software Testing and Analysis",
  ],

  // --- Human-Computer Interaction & Ubiquitous Computing ---
  "ACM Conference on Human Factors in Computing Systems": [
    "CHI Conference on Human Factors in Computing Systems",
    "Human Factors in Computing Systems",
  ],
  "ACM International Joint Conference on Pervasive and Ubiquitous Computing": [
    "Proceedings of the ACM on Interactive, Mobile, Wearable and Ubiquitous Technologies",
    "Proc. ACM Interact. Mob. Wearable Ubiquitous Technol.",
    "IMWUT",
    "Pervasive and Ubiquitous Computing",
  ],
  "ACM Conference on Computer Supported Cooperative Work and Social Computing": [
    "Computer Supported Cooperative Work and Social Computing",
    "Computer Supported Cooperative Work",
  ],

  // --- Major Journals and ISO-4 Abbrs ---
  "IEEE Transactions on Pattern Analysis and Machine Intelligence": [
    "IEEE Trans. Pattern Anal. Mach. Intell.",
    "IEEE Trans Pattern Anal Mach Intell",
    "TPAMI",
  ],
  "IEEE Transactions on Knowledge and Data Engineering": [
    "IEEE Trans. Knowl. Data Eng.",
    "IEEE Trans Knowl Data Eng",
    "TKDE",
  ],
  "IEEE Transactions on Image Processing": [
    "IEEE Trans. Image Process.",
    "IEEE Trans Image Process",
    "TIP",
  ],
  "IEEE Transactions on Visualization and Computer Graphics": [
    "IEEE Trans. Vis. Comput. Graph.",
    "TVCG",
  ],
  "IEEE Transactions on Dependable and Secure Computing": [
    "IEEE Trans. Dependable Secure Comput.",
    "TDSC",
  ],
  "IEEE Transactions on Software Engineering": [
    "IEEE Trans. Softw. Eng.",
    "IEEE Trans. Software Eng.",
    "TSE",
  ],
  "IEEE Transactions on Computers": [
    "IEEE Trans. Comput.",
    "IEEE Trans. Computers",
    "IEEE Trans Comput",
    "TC",
  ],
  "IEEE Transactions on Information Theory": [
    "IEEE Trans. Inf. Theory",
    "IEEE Trans Inf Theory",
    "TIT",
  ],
  "IEEE Transactions on Information Forensics and Security": [
    "IEEE Trans. Inf. Forensics Security",
    "TIFS",
  ],
  "IEEE Transactions on Neural Networks and learning systems": [
    "IEEE Transactions on Neural Networks and Learning Systems",
    "IEEE Trans. Neural Netw. Learn. Syst.",
    "TNNLS",
  ],
  "IEEE/ACM Transactions on Audio, Speech and Language Processing": [
    "IEEE/ACM Trans. Audio, Speech and Lang. Proc.",
    "IEEE/ACM Trans Audio Speech Lang Proc",
    "TASLP",
  ],
  "IEEE Transactions on Multimedia": [
    "IEEE Trans. Multimed.",
    "TMM",
  ],
  "IEEE Transactions on Automatic Control": [
    "IEEE Trans. Autom. Control",
    "TAC",
  ],
  "IEEE Transactions on Cybernetics": [
    "IEEE Trans. Cybern.",
    "TCYB",
  ],
  "IEEE Transactions on Evolutionary Computation": [
    "IEEE Trans. Evol. Comput.",
    "TEC",
  ],
  "IEEE Transactions on Mobile Computing": [
    "IEEE Trans. Mob. Comput.",
    "TMC",
  ],
  "IEEE Transactions on Services Computing": [
    "IEEE Trans. Serv. Comput.",
    "TSC",
  ],
  "IEEE Transactions on Computer-Aided Design of Integrated Circuits And System": [
    "IEEE Transactions on Computer-Aided Design of Integrated Circuits and Systems",
    "IEEE Trans. Comput.-Aided Des. Integr. Circuits Syst.",
    "TCAD",
  ],
  "ACM Transactions on Computer Systems": [
    "ACM Trans. Comput. Syst.",
    "TOCS",
  ],
  "ACM Transactions on Database Systems": [
    "ACM Trans. Database Syst.",
    "TODS",
  ],
  "ACM Transactions on Graphics": [
    "ACM Trans. Graph.",
    "TOG",
  ],
  "ACM Transactions on Information Systems": [
    "ACM Trans. Inf. Syst.",
    "TOIS",
  ],
  "ACM Transactions on Software Engineering and Methodology": [
    "ACM Trans. Softw. Eng. Methodol.",
    "TOSEM",
  ],
  "ACM Transactions on Computer-Human Interaction": [
    "ACM Trans. Comput.-Hum. Interact.",
    "TOCHI",
  ],
  "IEEE/ACM Transactions on Networking": [
    "IEEE/ACM Trans. Netw.",
    "TON",
  ],
  "ACM Transactions on Intelligent Systems and Technology": [
    "ACM Trans. Intell. Syst. Technol.",
    "TIST",
  ],
  "ACM Transactions on Multimedia Computing, Communications and Applications": [
    "ACM Trans. Multimedia Comput. Commun. Appl.",
    "TOMM",
  ],
  "ACM Transactions on Multimedia Computing,Communications and Applications": [
    "ACM Trans. Multimedia Comput. Commun. Appl.",
    "TOMM",
  ],
  "ACM Transactions on Knowledge Discovery from Data": [
    "ACM Trans. Knowl. Discov. Data",
    "TKDD",
  ],
  "ACM Transactions on the Web": [
    "ACM Trans. Web",
    "TWEB",
  ],
  "Communications of the ACM": [
    "Commun. ACM",
    "CACM",
  ],
  "Journal of Machine Learning Research": [
    "J. Mach. Learn. Res.",
    "J Mach Learn Res",
    "JMLR",
  ],
  "Artificial Intelligence": [
    "Artif. Intell.",
    "Artificial Intelligence Journal",
  ],
  "The VLDB Journal": [
    "VLDB J.",
    "VLDB Journal",
    "VLDBJ",
  ],
  "Pattern Recognition": [
    "Pattern Recognit.",
    "PR",
  ],
  "International Journal of Computer Vision": [
    "Int. J. Comput. Vis.",
    "IJCV",
  ],
};
