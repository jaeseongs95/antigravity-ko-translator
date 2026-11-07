// Module: 02-static-ui-dict.js
// Responsibility: 0ms static UI Korean dictionary and synchronous pattern matchers.
  // Comprehensive 0ms Static UI Dictionary (O(1) lookup, NO network calls, NO statusbar/input-box-toolbar/proper-noun entries)
  const STATIC_UI_MAP = {
    // Top menu bar & window controls ('Antigravity' stays English)
    'Workspace': '작업공간',
    'Workspaces': '작업공간',
    'View': '보기',
    'Window': '창',
    'Help': '도움말',
    'File': '파일',
    'Edit': '편집',
    'Selection': '선택 영역',
    'Go': '이동',
    'Run': '실행',
    // Left sidebar & primary navigation
    'New Conversation': '새 대화',
    'Conversations': '대화 목록',
    'Conversation History': '대화 기록',
    'Open Conversation History': '대화 기록 열기',
    'This page is going away soon': '이 페이지는 곧 사라집니다',
    'Search conversations with': '대화 검색은 좌측 상단의',
    'in the top left.': '아이콘을 사용하세요.',
    'View archived in the sidebar': '보관된 대화는 사이드바',
    'menu)': '메뉴)에서 확인할 수 있습니다',
    'Outside of Project': '프로젝트 외부',
    'More Actions': '추가 작업',
    'More options': '더보기 옵션',
    'Automations': '자동화',
    'Scheduled Tasks': '예약 작업',
    'Customizations': '맞춤 설정',
    'Project': '프로젝트',
    'Projects': '프로젝트',
    'Not in Project': '프로젝트 미지정',
    'Untitled project': '이름 없는 프로젝트',
    'Settings': '설정',
    'Open Settings': '설정 열기',
    'Open settings menu': '설정 메뉴 열기',
    'Feedback': '피드백',
    'Provide Feedback': '피드백 보내기',
    'Give Feedback': '피드백 보내기',
    'Documentation': '문서',
    'Shortcuts': '단축키',
    'Keyboard Shortcuts': '키보드 단축키',
    'Keyboard shortcuts': '키보드 단축키',
    'Open Keyboard Shortcuts': '키보드 단축키 열기',
    // Right overview / auxiliary pane tabs
    'Overview': '개요',
    'Review': '변경 검토',
    'Files': '파일',
    'Files Changed': '변경된 파일',
    'Terminal': '터미널',
    'Terminals': '터미널',
    'Extensions': '확장 기능',
    'Plugins': '플러그인',
    'Subagents': '서브에이전트',
    'Background Tasks': '백그라운드 작업',
    'Background Commands': '백그라운드 명령',
    'CLI Project': 'CLI 프로젝트',
    'No conversations yet': '아직 대화가 없습니다',
    'Artifacts': '산출물',
    'Customize Sections': '섹션 맞춤 설정',
    'Preview': '미리보기',
    'Embedded web preview': '내장 웹 미리보기',
    'New Browser': '새 브라우저',
    'Open in Built-in Browser': '내장 브라우저에서 열기',
    // Chat canvas static labels
    'Conversation Log': '대화 기록',
    'Load older messages': '이전 메시지 불러오기',
    'No more older messages': '더 이상 이전 메시지가 없습니다',
    'Working': '작업 중',
    'Working...': '작업 중...',
    'Working. Working': '작업 중...',
    'Thinking': '생각하는 중',
    'Thinking...': '생각하는 중...',
    'Thought Process': '생각 과정',
    'just now': '방금 전',
    'yesterday': '어제',
    // Common buttons & actions
    'Open': '열기',
    'Open Folder': '폴더 열기',
    'Learn more': '자세히 알아보기',
    'Show Less': '접기',
    'Show All': '모두 보기',
    'Yes, allow this time': '예, 이번에만 허용',
    'Yes, allow once': '예, 이번에만 허용',
    'Yes': '예',
    'No': '아니요',
    '(tell the agent what to do instead)': '(대신 수행할 작업을 에이전트에게 지시)',
    'tell the agent what to do instead': '대신 수행할 작업을 에이전트에게 지시',
    'Tell the agent what to do instead': '대신 수행할 작업을 에이전트에게 지시',
    'Tell the agent what to do instead...': '대신 수행할 작업을 에이전트에게 입력하세요...',
    'This command will run outside the sandbox and may modify files or make network requests.':
      '이 명령은 샌드박스 외부에서 실행되며 파일을 수정하거나 네트워크 요청을 수행할 수 있습니다.',
    'Other': '기타 (직접 입력)',
    '(Recommended)': '(권장)',
    'Skip': '건너뛰기',
    'Submit': '확인',
    'Enter': '확인',
    'Continue': '계속',
    'Retry': '다시 시도',
    'Dismiss': '닫기',
    'Dismiss error': '오류 닫기',
    'Confirm': '확인',
    'Save': '저장',
    'Reset': '초기화',
    'Apply': '적용',
    'Close': '닫기',
    'Back': '뒤로',
    'Next': '다음',
    'Done': '완료',
    'Delete': '삭제',
    'Download': '다운로드',
    'Accept': '수락',
    'Reject': '거절',
    'Proceed': '진행',
    'Approve': '승인',
    'Deny': '거부',
    'Allow': '허용',
    'Always Allow': '항상 허용',
    'Allow Once': '이번에만 허용',
    'Always Ask': '항상 묻기',
    'Always Proceed': '항상 진행',
    'Auto (Preview)': '자동 (미리보기)',
    'Auto': '자동',
    'Request Review': '검토 요청',
    'Require Review': '검토 필요',
    'Proceed in Sandbox': '샌드박스 내 진행',
    'Inherit Global': '전역 설정 상속',
    'Custom': '사용자 지정',
    // MCP & Auth action buttons
    'Authenticate': '인증',
    'Logout': '로그아웃',
    'Log out': '로그아웃',
    'Sign in': '로그인',
    'Sign out': '로그아웃',
    'Sign out of this server?': '이 서버에서 로그아웃하시겠습니까?',
    'Delete server': '서버 삭제',
    'Paste auth code': '인증 코드 붙여넣기',
    'Unknown Server': '알 수 없는 서버',
    'Refresh': '새로고침',
    'Reconnect': '재연결',
    'Configure': '설정',
    // Tool step action verbs
    'Explored': '탐색함',
    'Exploring': '탐색 중',
    'Created': '생성함',
    'Creating': '생성 중',
    'Canceled creation of': '생성 취소됨',
    'Edited': '수정함',
    'Editing': '수정 중',
    'Canceled edit to': '수정 취소됨',
    'Deleted': '삭제함',
    'Deleting': '삭제 중',
    'Canceled deletion of': '삭제 취소됨',
    'Read': '읽음',
    'Reading': '읽는 중',
    'Ran': '실행함',
    'Running': '실행 중',
    'Searched': '검색함',
    'Searching': '검색 중',
    'Analyzed': '분석함',
    'Analyzing': '분석 중',
    'Listed': '목록 조회함',
    'Listing': '목록 조회 중',
    'Viewed': '확인함',
    'Viewing': '확인 중',
    'Wrote': '작성함',
    'Writing': '작성 중',
    'Fetched': '가져옴',
    'Fetching': '가져오는 중',
    'Called': '호출함',
    'Calling': '호출 중',
    'Bookmarked': '북마크함',
    'Bookmarking': '북마크 중',
    'Canceled bookmark of': '북마크 취소됨',
    'Removed bookmark': '북마크 제거함',
    'Removing bookmark': '북마크 제거 중',
    'Canceled removal of bookmark': '북마크 제거 취소됨',
    // Navigation tooltips & context menus
    'Sidebar': '사이드바',
    'Display Options': '표시 옵션',
    'Create New Project': '새 프로젝트 만들기',
    'Add Project': '프로젝트 추가',
    'Project options': '프로젝트 옵션',
    'New Conversation in Project': '프로젝트에서 새 대화',
    'More options': '더보기',
    'More actions': '추가 작업',
    'Pin conversation': '대화 고정',
    'Unpin conversation': '대화 고정 해제',
    'Archive conversation': '대화 보관',
    'Unarchive conversation': '대화 보관 해제',
    'Delete conversation': '대화 삭제',
    'Rename conversation': '대화 이름 변경',
    'Stop execution': '실행 중지',
    'Toggle Overview Panel': '개요 패널 전환',
    'Toggle Sidebar': '사이드바 전환',
    'Toggle Auxiliary Pane': '보조 패널 전환',
    'Copy': '복사',
    'Copied': '복사됨',
    'Copy path': '경로 복사',
    'Copy email address': '이메일 주소 복사',
    'Copy error messages': '오류 메시지 복사',
    'Good response': '좋은 응답',
    'Bad response': '아쉬운 응답',
    'Undo to this point': '이 지점으로 되돌리기',
    'Scroll to Bottom': '맨 아래로 스크롤',
    'Cancel': '취소',
    'Cancel (Ctrl+D)': '취소 (Ctrl+D)',
    'Cancel Step': '단계 취소',
    'Cancel step': '단계 취소',
    'Cancel Generation': '생성 취소',
    'Go Back': '뒤로 가기',
    'Go Forward': '앞으로 가기',
    'Go Back in Pane': '패널 뒤로 가기',
    'Go Forward in Pane': '패널 앞으로 가기',
    'Search Conversations': '대화 검색',
    'Notifications': '알림',

    // =========================================================================
    // Settings & Customizations Pages (Titles, Sections, Descriptions, Options)
    // =========================================================================
    'General': '일반',
    'Models': '모델',
    'Quota': '쿼터 및 한도',
    'Permissions': '권한',
    'Permission Settings': '권한 설정',
    'Appearance': '모양 및 테마',
    'Account': '계정',
    'App': '앱',
    'Application': '애플리케이션',
    'Updater': '업데이트',
    'Developer': '개발자',
    'Advanced': '고급',
    'Labs': '실험실 (Labs)',
    'About': '정보',
    'Chat Settings': '채팅 설정',
    'Context Menus': '컨텍스트 메뉴',
    'Agent Settings': '에이전트 설정',
    'Agent Behavior': '에이전트 동작',
    'Execution': '실행',
    'Browser': '브라우저',
    'Skills': '스킬',
    'Rules': '규칙',
    'Hooks': '훅',
    'MCP Servers': 'MCP 서버',
    'Custom Agents': '사용자 지정 에이전트',
    'Default Customizations': '기본 맞춤 설정',
    'Customize Global Skills': '전역 스킬 맞춤 설정',
    'Include Jetski Default Customizations': '기본 제공 맞춤 설정 포함',
    'Include default customizations, such as default skills.': '기본 스킬 등 내장된 기본 맞춤 설정을 포함합니다.',
    'Marketplace': '마켓플레이스',
    'Installed': '설치됨',
    'Enabled': '활성화됨',
    'Disabled': '비활성화됨',
    'Enable': '활성화',
    'Disable': '비활성화',
    'Install': '설치',
    'Uninstall': '제거',
    'Loading plugins...': '플러그인 불러오는 중...',
    'No Plugins Available': '사용 가능한 플러그인 없음',

    // Settings -> General & Permissions
    'Configure agent execution, queued message delivery, and permissions.':
      '에이전트 실행, 대기열 메시지 전송 방식 및 권한을 설정합니다.',
    'Configure what the agent can do in local and remote conversations. ':
      '로컬 및 원격 대화에서 에이전트가 수행할 수 있는 작업 권한을 설정합니다. ',
    'Learn more.': '자세히 알아보기.',
    'Advanced >': '고급 >',
    'This Computer': '이 컴퓨터',
    'Remote': '원격',
    'Remote Conversations': '원격 대화',
    'Controls permissions for remote conversations.': '원격 대화에 대한 권한을 제어합니다.',
    'Configure the browser subagent. It requires Google Chrome to be installed. The browser subagent can be invoked by typing /browser in the conversation input box.':
      '브라우저 서브에이전트를 설정합니다. 사용하려면 Google Chrome 설치가 필요합니다. 대화 입력창에 /browser를 입력해 브라우저 서브에이전트를 호출할 수 있습니다.',
    'Ask anything, @ to mention, / for actions': '무엇이든 물어보세요 (@로 멘션, /로 작업 실행)',
    'Ask anything, @ to mention': '무엇이든 물어보세요 (@로 멘션)',
    'Message subagent, @ to mention, / for actions': '서브에이전트에게 메시지 보내기 (@로 멘션, /로 작업 실행)',
    'Message subagent, @ to mention': '서브에이전트에게 메시지 보내기 (@로 멘션)',
    'Listening. Ask anything.': '듣고 있습니다. 무엇이든 물어보세요.',
    'Active Skills': '활성 스킬',
    'Loading skills…': '스킬 불러오는 중…',
    'No skills available': '사용 가능한 스킬 없음',
    'Local Permissions': '로컬 권한',
    'Permission Details': '권한 세부 정보',
    'Your agent’s ability to execute commands is also controlled by enterprise security policies.':
      '에이전트의 명령어 실행 권한은 엔터프라이즈 보안 정책에 의해서도 제어됩니다.',
    'Your agent\'s ability to execute commands is also controlled by enterprise security policies.':
      '에이전트의 명령어 실행 권한은 엔터프라이즈 보안 정책에 의해서도 제어됩니다.',
    'Terminal sandbox is not supported in this environment': '이 환경에서는 터미널 샌드박스가 지원되지 않습니다',
    'Global Permissions': '전역 권한',
    'Configure global allowed and denied resource permissions.':
      '전역 허용 및 차단 리소스 권한을 설정합니다.',
    'Configure global allowed and denied resource permissions. ':
      '전역 허용 및 차단 리소스 권한을 설정합니다. ',
    'Permission Preset': '권한 프리셋',
    'Security Preset': '보안 프리셋',
    'Controls the actions the agent can take.': '에이전트가 수행할 수 있는 작업 범위를 제어합니다.',
    'Manually customize individual settings.': '개별 권한 설정을 수동으로 맞춤 설정합니다.',
    'Tool Permissions': '도구 권한',
    'Modify permissions for file, terminal, and MCP tools.':
      '파일, 터미널 및 MCP 도구에 대한 권한을 수정합니다.',
    'Modify permissions for file and terminal tools.':
      '파일 및 터미널 도구에 대한 권한을 수정합니다.',
    'Network Access Rules': '네트워크 접근 규칙',
    'Configure allowed and denied URLs for reading.':
      '읽기를 허용하거나 차단할 URL을 설정합니다.',
    'File Access Rules': '파일 접근 규칙',
    'Configure allowed and denied paths for file reads and writes.':
      '파일 읽기 및 쓰기를 허용하거나 차단할 경로를 설정합니다.',
    'File Permissions': '파일 권한',
    'File Reads': '파일 읽기',
    'Allow/deny agent read access to specific files or directories.':
      '특정 파일 또는 디렉터리에 대한 에이전트의 읽기 접근을 허용하거나 차단합니다.',
    'File Writes': '파일 쓰기',
    'Allow/deny agent write access to specific files or directories.':
      '특정 파일 또는 디렉터리에 대한 에이전트의 쓰기 접근을 허용하거나 차단합니다.',
    'Network Permissions': '네트워크 권한',
    'Read URLs': 'URL 읽기',
    'Allow/deny agent read access to specific URLs or domains.':
      '특정 URL 또는 도메인에 대한 에이전트의 읽기 접근을 허용하거나 차단합니다.',
    'Terminal & Tooling Permissions': '터미널 및 도구 권한',
    'Terminal Commands': '터미널 명령어',
    'Allow/deny specific terminal commands.': '특정 터미널 명령어의 실행을 허용하거나 차단합니다.',
    'Configure allowed terminal commands.': '허용할 터미널 명령어를 설정합니다.',
    'Commands Outside Sandbox': '샌드박스 외부 명령어',
    'Allow/deny agent command execution outside the sandbox.':
      '샌드박스 외부에서의 에이전트 명령어 실행을 허용하거나 차단합니다.',
    'Configure allowed commands outside the sandbox.':
      '샌드박스 외부에서 실행을 허용할 명령어를 설정합니다.',
    'MCP Tools': 'MCP 도구',
    'External tools the agent can call via Model Context Protocol.':
      'Model Context Protocol(MCP)을 통해 에이전트가 호출할 수 있는 외부 도구입니다.',
    'Configure external tools via Model Context Protocol.':
      'Model Context Protocol(MCP)을 통한 외부 도구 권한을 설정합니다.',
    'Configure GitHub access policies.': 'GitHub 접근 정책을 설정합니다.',
    'Outside of folders file access policy': '작업 폴더 외부 파일 접근 정책',
    'Configures how the agent tries to access files outside of its working folders.':
      '에이전트가 작업 폴더 외부의 파일에 접근할 때의 동작 방식을 설정합니다.',
    'Disabled by organization policy': '조직 정책에 의해 비활성화됨',
    'Blocked by organization policy': '조직 정책에 의해 차단됨',
    'managed by your organization': '조직에서 관리됨',

    // Settings -> Agent Behavior & Plan Review Policy
    'Plan Review Policy': '계획 검토 정책',
    'Review Policy': '검토 정책',
    'Artifact Review Policy': '산출물 검토 정책',
    'Artifact Review Mode': '산출물 검토 모드',
    'Whether the agent asks you to review its documents.':
      '에이전트가 작성한 문서를 사용자에게 검토 요청할지 여부를 설정합니다.',
    'Specifies the agent\'s behavior when asking for review on artifacts, which are documents it creates to enable a richer conversation experience.':
      '에이전트가 생성한 산출물(문서)에 대해 사용자 검토를 요청하는 방식을 지정합니다.',
    'The agent never asks for review. This maximizes the autonomy of the agent, but also has the highest risk of the agent operating over unsafe or injected artifact content.':
      '에이전트가 검토를 요청하지 않고 즉시 진행합니다. 자율성이 극대화되지만 신뢰할 수 없는 콘텐츠 처리 시 위험도가 높아집니다.',
    'Agent never asks for review. This maximizes the autonomy of the Agent, but also has the highest risk of the Agent operating over unsafe or injected Artifact content.':
      '에이전트가 검토를 요청하지 않고 즉시 진행합니다. 자율성이 극대화되지만 신뢰할 수 없는 콘텐츠 처리 시 위험도가 높아집니다.',
    'The agent always asks for review.': '에이전트가 항상 사용자에게 검토를 요청합니다.',
    'Agent always asks for review.': '에이전트가 항상 사용자에게 검토를 요청합니다.',
    'Type': '채팅창에',
    'and select': '입력 후',
    'to have the agent generate a plan.': '을(를) 선택하면 에이전트가 계획을 생성합니다.',

    // Settings -> Execution & Queued Messages & Sandbox
    'Queued Messages': '대기열 메시지',
    'Configure what the agent can do in local and remote conversations.':
      '로컬 및 원격 대화에서 에이전트가 수행할 수 있는 작업 권한을 설정합니다.',
    'Configure when follow-up messages are sent.': '후속 메시지를 전송하는 시점을 설정합니다.',
    'Queue': '대기열 추가',
    'Send Immediately': '즉시 보내기',
    'Interrupt the agent and send immediately.': '에이전트 응답을 중단하고 즉시 전송합니다.',
    'Queue until after the current turn.': '현재 턴이 끝날 때까지 대기열에 보관합니다.',
    'Enable Sandbox Mode (Preview)': '샌드박스 모드 활성화 (미리보기)',
    'Enable Sandbox Mode': '샌드박스 모드 활성화',
    'Restricts agent tools to a secure, isolated local sandbox.':
      '에이전트 도구를 안전하게 격리된 로컬 샌드박스 내부로 제한합니다.',
    'Terminal Sandbox': '터미널 샌드박스',
    'Enable Terminal Sandbox': '터미널 샌드박스 활성화',
    'Run terminal commands with sandbox restrictions.': '샌드박스 제한을 적용하여 터미널 명령어를 실행합니다.',
    'Sandbox Allow Network': '샌드박스 네트워크 허용',
    'Allow sandboxed commands to make network requests.':
      '샌드박스 내부 명령어의 네트워크 요청을 허용합니다.',
    'Terminal Command Auto Execution': '터미널 명령어 자동 실행',
    'Controls whether terminal commands require your approval before running.':
      '터미널 명령어 실행 전 사용자 승인 필요 여부를 제어합니다.',
    'Terminal commands automatically proceed inside the sandbox. A command that needs to leave the sandbox proceeds only if an agent judges it reversible, and otherwise requests review.':
      '샌드박스 내부 명령어는 자동 진행되며, 샌드박스 외부 실행이 필요한 명령어는 되돌릴 수 있다고 판단될 때만 진행하고 그 외에는 검토를 요청합니다.',
    'The agent always asks for confirmation before executing terminal commands (except those in the Allow list).':
      '허용 목록(Allowlist)에 있는 명령어를 제외하고 항상 실행 전 확인을 요청합니다.',
    'Terminal command automatically proceeds if the command runs inside the sandbox. Otherwise, it requests review.':
      '샌드박스 내부에서 실행되는 명령어는 자동 진행하고, 그 외에는 검토를 요청합니다.',
    'Allow List Terminal Commands': '터미널 허용 명령어 목록 (Allowlist)',
    'The agent auto-executes commands matched by an allow list entry.':
      '허용 목록 항목과 일치하는 명령어는 에이전트가 승인 없이 자동 실행합니다.',
    'Deny List Terminal Commands': '터미널 차단 명령어 목록 (Denylist)',
    'The agent asks for permission before executing commands matched by a deny list entry.':
      '차단 목록 항목과 일치하는 명령어는 실행 전 반드시 사용자 승인을 요청합니다.',
    'Command Setup Script': '명령어 초기 설정 스크립트',
    'A shell setup script run before every command the agent executes.':
      '에이전트가 명령어를 실행하기 전에 매번 먼저 실행할 셸 초기 설정 스크립트입니다.',
    'Strict Mode': '엄격 모드 (Strict Mode)',
    'Enforce settings that prevent the agent from autonomously running targeted exploits and require human review for all agent actions. Visit antigravity.google/docs/strict-mode for details.':
      '에이전트의 자율적 위험 작업을 차단하고 모든 에이전트 작업에 대해 사용자 검토를 강제합니다.',
    'Autonomous Mode': '자율 실행 모드 (Autonomous Mode)',
    'Adds an Autonomous Mode switch to the modes dropdown below the input box. Turns sent with it on run non-interactively: the agent does not ask questions or request new permissions.':
      '입력창 하단 모드 드롭다운에 자율 실행 모드 스위치를 추가합니다. 활성화 시 에이전트가 질문이나 추가 권한 요청 없이 비대화형으로 실행됩니다.',

    // Settings -> Browser
    'Browser Subagent': '브라우저 서브에이전트',
    'Browser Subagent Viewer': '브라우저 서브에이전트 뷰어',
    'Browser Task': '브라우저 작업',
    'Built-in Browser': '내장 브라우저',
    'Side Panel Preview': '사이드 패널 미리보기',
    'Configure link opening and built-in browser preferences.': '링크 열기 방식 및 내장 브라우저 환경설정을 구성합니다.',
    'Download Location': '다운로드 위치',
    'Folder where files downloaded in the built-in browser are saved.': '내장 브라우저에서 다운로드한 파일이 저장되는 폴더입니다.',
    'Change…': '변경…',
    'Browsing History': '브라우징 기록',
    'Clear visited URLs and autocomplete suggestions from the built-in browser.':
      '내장 브라우저의 방문 URL 기록과 자동 완성 추천 항목을 지웁니다.',
    'Clear visited URLs and autocomplete suggestions from side panel preview.':
      '사이드 패널 미리보기의 방문 URL 기록과 자동 완성 추천 항목을 지웁니다.',
    'Browser Actuation Permissions': '브라우저 조작 권한',
    'Execute URLs': '실행 허용 URL',
    'Allow/deny agent browser actuation access to specific URLs.':
      '특정 URL에 대한 에이전트의 브라우저 조작 접근을 허용하거나 차단합니다.',
    'New Conversation Button': '새 대화 버튼 동작',
    'Which workspace the New Conversation button and keyboard shortcut start you in.':
      '새 대화 버튼 및 단축키 실행 시 시작할 기본 작업공간을 설정합니다.',
    'New Workspace': '새 작업공간',
    'No Project': '프로젝트 없음',
    'Last Workspace': '마지막 작업공간',
    'Create a new workspace from your first message.': '첫 메시지에서 새 작업공간을 생성합니다.',
    'Start without a workspace, for general questions.': '일반적인 질문을 위해 작업공간 없이 시작합니다.',
    'Reuse your last workspace.': '마지막으로 사용한 작업공간을 다시 사용합니다.',
    'Configure the browser subagent. It requires': '브라우저 서브에이전트를 설정합니다. 사용하려면',
    'to be installed. The browser subagent can be invoked by typing /browser in the conversation input box.':
      '설치가 필요합니다. 대화 입력창에 /browser를 입력해 브라우저 서브에이전트를 호출할 수 있습니다.',
    'The browser subagent has been disabled by your administrator. Contact your administrator to enable browser use.':
      '관리자에 의해 브라우저 서브에이전트가 비활성화되었습니다. 사용하려면 관리자에게 문의하세요.',
    'Enable Browser Tools': '브라우저 도구 활성화',
    'Browser Javascript Execution Policy': '브라우저 JavaScript 실행 정책',
    'Controls whether the agent can run custom JavaScript to automate complex browser actions.':
      '복잡한 브라우저 작업을 자동화하기 위해 에이전트가 사용자 정의 JavaScript를 실행할 수 있을지 제어합니다.',
    'Block all browser JavaScript execution.': '모든 브라우저 JavaScript 실행을 차단합니다.',
    'Prompt for approval before running browser scripts.': '브라우저 스크립트 실행 전 승인을 요청합니다.',
    'Allow full browser script execution without prompting.': '승인 요청 없이 브라우저 스크립트 실행을 허용합니다.',
    'Browser Actuation Rules': '브라우저 조작 규칙',
    'Configure allowed and denied URLs for browser actuation.':
      '브라우저 조작을 허용하거나 차단할 URL을 설정합니다.',
    'Chrome Binary Path': 'Chrome 실행 파일 경로',
    'Path to the Chrome/Chromium executable. Leave empty for auto-detection.':
      'Chrome/Chromium 실행 파일 경로입니다. 비워 두면 자동으로 감지합니다.',
    'Browser User Profile Path': '브라우저 사용자 프로필 경로',
    'Custom path for the browser user profile directory. Leave empty for default (~/.gemini/antigravity-browser-profile).':
      '브라우저 사용자 프로필 디렉터리의 사용자 지정 경로입니다. 비워 두면 기본 경로를 사용합니다.',
    'Browser CDP Port': '브라우저 CDP 포트',
    'Port number for Chrome DevTools Protocol remote debugging. Leave empty for default (9222).':
      'Chrome DevTools Protocol 원격 디버깅 포트 번호입니다. 비워 두면 기본값(9222)을 사용합니다.',

    // Settings -> Appearance, Notifications, App, Advanced, Labs, Account
    'Enable Sounds for Agent': '에이전트 알림음 활성화',
    'Play a sound when your action is needed or the agent finishes.':
      '사용자 확인이 필요하거나 에이전트 작업이 완료되었을 때 소리를 재생합니다.',
    'Enable Notifications for Agent': '에이전트 시스템 알림 활성화',
    'Show system notifications when your action is needed or the agent finishes.':
      '사용자 확인이 필요하거나 에이전트 작업이 완료되었을 때 시스템 알림을 표시합니다.',
    'Verbose Agent Chat': '상세 에이전트 채팅 표시',
    'Display and preserve intermediate thinking steps.': '중간 추론 단계를 화면에 표시하고 보존합니다.',
    'Conversation Steps': '대화 단계 표시',
    'Choose how much detail is shown during a conversation.':
      '대화 중 표시할 중간 과정의 상세 수준을 선택합니다.',
    'Verbose': '상세히',
    'Waiting for your approval': '사용자 승인 대기 중',
    'Custom Context Menus': '맞춤 컨텍스트 메뉴',
    'Replace the default browser right-click menu with quick actions.':
      '기본 우클릭 메뉴를 빠른 작업 메뉴로 대체합니다.',
    'Conversation Width': '대화창 너비',
    'Configure the maximum width of the conversation panel.': '대화 패널의 최대 너비를 설정합니다.',
    'Narrow': '좁게',
    'Wide': '넓게',
    'Default': '기본값',
    'Fill': '가득 채우기',
    'Markdown Artifact Width': '마크다운 산출물 너비',
    'Configure the default width of markdown artifacts.': '마크다운 산출물의 기본 너비를 설정합니다.',
    'Prevent Sleep': '절전 모드 방지',
    'Prevent the computer from sleeping while the app is running.':
      '앱이 실행 중일 때 컴퓨터가 절전 모드로 전환되지 않도록 방지합니다.',
    'Keep In Menu Bar': '메뉴바에 유지',
    'Keep the app accessible from the menu bar and running in the background when all windows are closed.':
      '모든 창을 닫아도 앱을 백그라운드에서 실행하며 메뉴바에서 접근할 수 있도록 유지합니다.',
    'Automatic Check for Updates': '자동 업데이트 확인',
    'Automatically prompt you to restart the app when a new update is available. When disabled, you can check for updates manually from the app menu.':
      '새 업데이트가 있을 때 앱 재시작 안내를 자동으로 표시합니다.',
    'Enable Remote Control': '원격 제어 활성화',
    'Manage your conversations from the companion website.': '컴패니언 웹사이트에서 대화를 관리합니다.',
    'Nickname': '별칭 (Nickname)',
    'A nickname for identifying this application in the companion website. Changing this will restart the connection.':
      '컴패니언 웹사이트에서 이 앱을 식별하기 위한 별칭입니다. 변경 시 연결이 재시작됩니다.',
    'Enable Demo Mode (Beta)': '데모 모드 활성화 (베타)',
    'Try out early-stage features before they ship. These may be changed or removed at any time. These features are experimental, and we make no guarantees about performance or functionality.':
      '출시 전 초기 단계 기능을 미리 사용해 보세요. 실험적 기능이므로 언제든 변경되거나 제거될 수 있습니다.',
    'Upload Debug Bundle': '디버그 번들 업로드',
    'Upload debug bundle': '디버그 번들 업로드',
    'Download Diagnostics': '진단 데이터 다운로드',
    'Select Billing Model': '과금 모델 선택',
    'Billing model': '과금 모델',
    'Pay As You Go': '종량제 (Pay As You Go)',
    'Not configured': '설정되지 않음',
    'Choose a License': '라이선스 선택',
    'Available licenses': '사용 가능한 라이선스',
    'Choose Region': '리전 선택',
    'Global': '글로벌 (Global)',
    'United States': '미국 (US)',
    'Europe': '유럽 (EU)',
    'Failed to parse settings. Fix and restart.': '설정을 파싱하지 못했습니다. 수정 후 다시 시작하세요.',

    // Keyboard Shortcuts Modal / Command Palette items
    'Accept Step': '단계 수락',
    'Reject Step': '단계 거절',
    'Open Conversation Picker': '대화 선택기 열기',
    'Toggle Model Selector': '모델 선택기 전환',
    'Start Voice Recording': '음성 녹음 시작',
    'Stop Voice Recording': '음성 녹음 중지',
    'Toggle Voice Recording': '음성 녹음 전환',
    'Mute Live Chat Mic': '마이크 음소거 전환',
    'Toggle Terminal': '터미널 전환',
    'Toggle File Viewer': '파일 뷰어 전환',
    'Toggle Project Selector': '프로젝트 선택기 전환',
    'Toggle Environment Selector': '환경 선택기 전환',
    'Toggle Maximize Auxiliary Pane': '보조 패널 최대화 전환',
    'New Window': '새 창',
    'Close Tab': '탭 닫기',
    'Continue Response': '응답 계속 생성',
    'Split Terminal': '터미널 분할',
    'Split Conversation Vertically': '대화창 수직 분할',
    'Split Conversation Horizontally': '대화창 수평 분할',
    'Equalize Split Panes': '분할 패널 크기 균등화',
    'Close Terminal Tab': '터미널 탭 닫기',
    'New Terminal Tab': '새 터미널 탭',
    'New Tab': '새 탭',
    'File Picker': '파일 선택기',
    'Open Command Palette': '명령 팔레트 열기',
    'Open Workspace Selector': '작업공간 선택기 열기',
    'Add to Chat': '채팅에 추가',
    'Quote Selection': '선택 영역 인용',
    'Open in Code Search': '코드 검색에서 열기',
    'Comment on Selection': '선택 영역에 댓글 달기',
    'Focus Input': '입력창 포커스',
    'Zoom In': '확대',
    'Zoom Out': '축소',
    'Reset Zoom': '배율 초기화',
    'Find in Pane': '패널 내 찾기',
    'Complete Onboarding Step': '온보딩 단계 완료',
    'Code Search': '코드 검색',
    'Open Commit Graph': '커밋 그래프 열기',
    'Select Next Conversation': '다음 대화 선택',
    'Select Previous Conversation': '이전 대화 선택',
    'Open Conversation': '대화 열기',
    'Mark as Read': '읽음으로 표시',
    'Mark as Unread': '읽지 않음으로 표시',
    'Delete Conversation': '대화 삭제',
    'Archive / Restore': '보관 / 복원',
    'Terminal: Add to Chat': '터미널: 채팅에 추가',
    'Copy Conversation Markdown': '대화 마크다운 복사',
    'Restart Main Language Server': '메인 언어 서버 재시작',
    'Archive This Conversation': '이 대화 보관',
    'Pin This Conversation': '이 대화 고정',
    'Unpin This Conversation': '이 대화 고정 해제',
    'Find in Conversation': '대화 내 찾기',
    'Toggle Between Light/Dark Themes': '라이트/다크 테마 전환',
    'Previous Aux Pane Tab': '이전 보조 패널 탭',
    'Next Aux Pane Tab': '다음 보조 패널 탭',
    'Collapse All Folders': '모든 폴더 접기',
    'Expand All Folders': '모든 폴더 펼치기',
    'Select All': '모두 선택',
    'Default Cog Repository': '기본 Cog 저장소',
    'Git-on-Borg repository used when creating a new Cog workspace from your initial prompt (e.g., chromium/src or android/platform/superproject).':
      '초기 프롬프트에서 새 Cog 작업공간을 생성할 때 사용할 Git-on-Borg 저장소입니다 (예: chromium/src 또는 android/platform/superproject).',
    'Default Cog Branch / Ref': '기본 Cog 브랜치 / 참조',
    'Optional branch or ref used when creating a new Cog workspace (defaults to main if unset).':
      '새 Cog 작업공간 생성 시 사용할 선택적 브랜치 또는 참조입니다 (미설정 시 기본값은 main).',
    'Sync JJ Worktrees to Head': 'JJ 작업 트리를 Head에 동기화',
    'Sync newly created JJ worktrees to head when starting a conversation.':
      '대화를 시작할 때 새로 생성된 JJ 작업 트리를 head에 동기화합니다.',
    'Use full VCS clones for Best of N': 'Best of N에 전체 VCS 복제본 사용',
    'Regroup Google3 Chats': 'Google3 대화 재그룹화',
    'Configure a chat bot so you can use Jetski directly from Google Chat.':
      'Google Chat에서 Jetski를 바로 사용할 수 있도록 챗봇을 설정합니다.',
    'For help, visit': '도움말은',
    'or join the': '을(를) 방문하거나',
    'chat space': '채팅 스페이스에 참여하세요',
    'The Google3 project is deprecated': 'Google3 프로젝트는 더 이상 사용되지 않습니다',
    'The settings here only apply to conversations that are under Google3 Projects, which are deprecated. Any new conversations should be grouped by workspace and apply global settings.':
      '여기의 설정은 더 이상 사용되지 않는 Google3 프로젝트 하위의 대화에만 적용됩니다. 모든 새 대화는 작업공간별로 그룹화되며 전역 설정이 적용됩니다.',
    // Automations (/sidecars) & Scheduled Tasks
    'Create with Prompt': '프롬프트로 만들기',
    'Automation': '자동화',
    'Scheduled Task': '예약 작업',
    'Search automations...': '자동화 검색...',
    'Search tasks...': '작업 검색...',
    'No automations configured.': '설정된 자동화가 없습니다.',
    'No scheduled tasks configured.': '설정된 예약 작업이 없습니다.',
    'No automations matching your search': '검색과 일치하는 자동화가 없습니다',
    'No scheduled tasks matching your search': '검색과 일치하는 예약 작업이 없습니다',
    'Refresh all credentials': '모든 자격 증명 새로고침',
    'Refreshed credentials for all automations.': '모든 자동화의 자격 증명을 새로고침했습니다.',
    'Failed to refresh credentials': '자격 증명 새로고침 실패',
    'Sidecar feature is not available.': '자동화(Sidecar) 기능을 사용할 수 없습니다.',
    'Multi-conversation view is not available': '다중 대화 보기를 사용할 수 없습니다',
    'Runs on': '실행 위치',
    'This computer': '이 컴퓨터',
    'Runs on this computer': '이 컴퓨터에서 실행',
    'Cloud': '클라우드',
    'Runs in the cloud': '클라우드에서 실행',
    'Schedule': '일정',
    'Time Zone': '시간대',
    'Schedules and events.': '일정 및 이벤트.',
    'Schedules only.': '일정 전용.',
    'Uses your local files and tools. Schedules only.': '로컬 파일과 도구를 사용합니다. 일정 전용.',
    'Trigger': '트리거',
    'Environment': '환경',
    'Execution Identity': '실행 자격 증명',
    'You don\'t have any projects created. Please create a project first.': '생성된 프로젝트가 없습니다. 먼저 프로젝트를 생성해 주세요.',
    'No projects created': '생성된 프로젝트 없음',
    'Select workspace': '작업공간 선택',
    'New Project': '새 프로젝트',
    'Prompt': '프롬프트',
    'Enter a prompt for the agent to run...': '에이전트가 실행할 프롬프트를 입력하세요...',
    'Prompt to run when triggered...': '트리거될 때 실행할 프롬프트...',
    'Prompt to execute on schedule...': '일정에 따라 실행할 프롬프트...',
    'Cron expression e.g. 0 */6 * * *': 'Cron 표현식 (예: 0 */6 * * *)',
    'Scheduled': '예약됨',
    'Generic': '일반',
    'Status': '상태',
    'Type': '유형',
    'Command': '명령어',
    'Uptime': '가동 시간',
    'Events': '이벤트',
    'Loading events...': '이벤트 불러오는 중...',
    'No events recorded.': '기록된 이벤트가 없습니다.',
    'Failed to fetch events': '이벤트를 불러오지 못했습니다',
    'Actions': '작업',
    'Manage Permissions': '권한 관리',
    'Run Now': '지금 실행',
    'Restart': '재시작',
    'View Logs': '로그 보기',
    'Delete Task': '작업 삭제',
    'Not scheduled': '예약되지 않음',
    'Command execution': '명령어 실행',
    'Hourly': '매시간',
    'Daily': '매일',
    'Weekly': '매주',
    'Custom cron schedule': '사용자 지정 Cron 일정',
    'Sunday': '일요일',
    'Monday': '월요일',
    'Tuesday': '화요일',
    'Wednesday': '수요일',
    'Thursday': '목요일',
    'Friday': '금요일',
    'Saturday': '토요일',
    'Next: Review Permissions': '다음: 권한 검토',
    'Resolving...': '확인 중...',
    'Resolving permissions...': '권한 확인 중...',
    'Folders these agents can access.': '이 에이전트가 접근할 수 있는 폴더입니다.',
    'Access grants': '접근 권한 부여',
    'Commands and files these agents can use.': '이 에이전트가 사용할 수 있는 명령어 및 파일입니다.',
    'Confirm & Save': '확인 및 저장',
    'Saving...': '저장 중...',
    'Unsandboxed commands': '비샌드박스 명령어',
    'Read files': '파일 읽기',
    'Write files': '파일 쓰기',
    'Read URLs': 'URL 읽기',
    'Browser actions': '브라우저 작업',
    'MCP tools': 'MCP 도구',
    'Admin escalation': '관리자 권한 상승',
    'No folder selected': '선택된 폴더 없음',
    'Change': '변경',
    'Browse': '찾아보기',
    'Credentials expiring soon. Refresh credentials to keep this automation running': '자격 증명이 곧 만료됩니다. 자동화를 계속 실행하려면 자격 증명을 새로고침하세요',
    'Credentials expired. This automation will not run until credentials are refreshed': '자격 증명이 만료되었습니다. 자격 증명을 새로고침하기 전까지 자동화가 실행되지 않습니다',
    // Ask Question & Permission Approval Widgets
    'Other (write your answer)': '기타 (직접 입력)',
    '(tell the agent what to do instead)': '(대신 수행할 작업을 입력하세요)',
    'Yes, execute a test run now to configure permissions': '예, 지금 테스트 실행을 진행하여 권한을 설정합니다',
    '(Recommended) Yes, execute a test run now to configure permissions': '(권장) 예, 지금 테스트 실행을 진행하여 권한을 설정합니다',
    'What should be the cadence of the automation?': '자동화 실행 주기를 어떻게 설정할까요?',
    'Pushing commits to the remote repository lands work on a shared release branch and modifies remote state visible to others.':
      '원격 저장소에 커밋을 push하면 공유 브랜치에 변경 사항이 반영되며 다른 사용자에게 보이는 원격 상태가 수정됩니다.',
    'Skip': '건너뛰기',
    'Submit': '제출',
    'Continue': '확인',
    'Multi-select': '다중 선택',
    'Previous question': '이전 질문',
    'Next question': '다음 질문',
    'Cancel questionnaire': '질문 취소',
    'Cancel Questionnaire and Stop the Agent': '질문을 취소하고 에이전트 중지',
    'Skipped': '건너뜀',
    'No answer provided': '입력된 답변 없음',
    'Edit permission target': '권한 대상 편집',
    'Click to copy full command': '전체 명령어를 복사하려면 클릭하세요',
    // Additional Placeholders & Modals
    'Search customizations...': '맞춤 설정 검색...',
    'Search conversations...': '대화 검색...',
    'Search for conversations...': '대화 검색...',
    'Search projects...': '프로젝트 검색...',
    'Search workspaces...': '작업공간 검색...',
    'Search for commands...': '명령어 검색...',
    'Search file contents...': '파일 내용 검색...',
    'Search across files...': '파일 전체 검색...',
    'Search MCP servers by name': '이름으로 MCP 서버 검색',
    'Search skills…': '스킬 검색…',
    'Search all skills on Agent Market…': '에이전트 마켓에서 모든 스킬 검색…',
    'Filter resources...': '리소스 필터링...',
    'Enter project name...': '프로젝트 이름 입력...',
    'Select Workspace...': '작업공간 선택...',
    'Select or enter a workspace URI': '작업공간 URI 선택 또는 입력',
    'Conversation name': '대화 이름',
    'Group name': '그룹 이름',
    'Rename Group': '그룹 이름 변경',
    'Rename': '이름 변경',
    'Create': '만들기',
    'Add': '추가',
    'Clear': '지우기',
    'Clear search': '검색 지우기',
    'Copy Path': '경로 복사',
    'Copied to clipboard': '클립보드에 복사됨',
    'See more': '더 보기',
    'See less': '접기',
    'Loading...': '불러오는 중...',
    'Adding...': '추가 중...',
    'Removing...': '제거 중...',
    'Deleting...': '삭제 중...',
    'Submitting...': '제출 중...',
    'Remove All': '모두 제거',
    'No description available.': '설명이 없습니다.',
    'No results found.': '검색 결과가 없습니다.',
    // Models & Usage / Notifications / Feedback / Developer
    'Models & Usage': '모델 및 사용량',
    'Manage your model quota and credits.': '모델 할당량 및 크레딧을 관리합니다.',
    'Model Quota': '모델 할당량',
    'No quota information available.': '할당량 정보가 없습니다.',
    'Refresh quota and credits data': '할당량 및 크레딧 데이터 새로고침',
    'Plan': '요금제',
    'Upgrade': '업그레이드',
    'Model Credits': '모델 크레딧',
    'Enable AI Credit Overages': 'AI 크레딧 초과 사용 활성화',
    'See Activity': '활동 내역 보기',
    'Get More AI Credits': 'AI 크레딧 추가 구매',
    'Notifications': '알림',
    'Manage your notification preferences.': '알림 환경설정을 관리합니다.',
    'Sound': '소리',
    'Volume': '음량',
    'Set the volume of agent sounds.': '에이전트 알림음 음량을 설정합니다.',
    'Chime volume': '알림음 음량',
    'Developer': '개발자',
    'Developer-only tools. These settings are stored locally in this browser and do not affect other users.':
      '개발자 전용 도구입니다. 이 설정은 현재 브라우저에 로컬로 저장되며 다른 사용자에게 영향을 주지 않습니다.',
    'Manage your plan, credentials, and general preferences.':
      '요금제, 자격 증명 및 일반 환경설정을 관리합니다.',
    'Enable Telemetry': '원격 분석 데이터 수집 허용',
    'When toggled on, Antigravity collects usage data to help Google enhance performance and features.':
      '활성화하면 Google이 성능과 기능을 개선할 수 있도록 Antigravity 사용 데이터를 수집합니다.',
    'Marketing Emails': '마케팅 이메일 수신',
    'Receive product updates, tips, and promotions from Google Antigravity via email.':
      'Google Antigravity의 제품 업데이트, 팁 및 프로모션 정보를 이메일로 받습니다.',
    'Your Plan: Google AI Ultra': '현재 요금제: Google AI Ultra',
    'You are subscribed to the best Google AI plan.': '최상위 Google AI 요금제를 구독 중입니다.',
    'Email': '이메일',
    'Sign Out': '로그아웃',
    'By using this app, you agree to its': '이 앱을 사용하면 다음 약관에 동의하게 됩니다:',
    'Terms of Service': '서비스 약관',
    'Bug Report': '버그 신고',
    'Feature Request': '기능 요청',
    'Auth and Billing': '인증 및 결제',
    'Remote Control Issue': '원격 제어 문제',
    'General Feedback': '일반 피드백',
    'Feedback Type': '피드백 유형',
    'Description': '설명',
    'Steps to Reproduce': '재현 단계',
    'Please list the steps to reproduce the issue': '문제를 재현하는 단계를 입력해 주세요',
    'Attach a screenshot (optional)': '스크린샷 첨부 (선택 사항)',
    'Attach Antigravity server logs': 'Antigravity 서버 로그 첨부',
    'Describe the bug you encountered...': '발생한 버그를 설명해 주세요...',
    'Describe the feature you would like to see...': '원하시는 기능을 설명해 주세요...',
    'Describe your auth or billing issue...': '인증 또는 결제 문제를 설명해 주세요...',
    'Describe your Remote Control issue...': '원격 제어 문제를 설명해 주세요...',
    'Enter your feedback here...': '여기에 피드백을 입력해 주세요...',

    // Automation / Sidecars (추가 누락분)
    'Automation saved': '자동화가 저장되었습니다',
    'Creating…': '생성 중…',
    'Creating...': '생성 중...',
    'Loading logs...': '로그 불러오는 중...',
    'No logs available.': '표시할 로그가 없습니다.',
    'Task Logs': '작업 로그',
    'Close Logs Modal': '로그 모달 닫기',
    'Sent Message': '보낸 메시지',
    'New Conversation': '새 대화',
    'Payload:': '페이로드:',
    'ID:': 'ID:',
    'Error:': '오류:',
    'Process Error:': '프로세스 오류:',
    'Manager Error:': '매니저 오류:',
    'UI Extension (AuxPane)': 'UI 확장 (보조 패널)',
    'Starting': '시작 중',
    'Stopped': '중지됨',
    'Backoff': '재시도 대기',
    'Unknown': '알 수 없음',
    'See less': '접기',
    'Triggered': '트리거됨',
    'around': '경 —',
    'on': '요일:',

    // Automation Declared Permissions Modal & Delete Modal
    'This extension has no declared permissions requiring user input.': '이 확장에는 사용자 입력이 필요한 선언된 권한이 없습니다.',
    'Please fill out all required values to continue.': '계속하려면 모든 필수 값을 입력해 주세요.',
    'Please fill out all required argument values before continuing.': '계속하기 전에 모든 필수 인자 값을 입력해 주세요.',
    'Failed to resolve permissions. Please try again.': '권한을 확인하지 못했습니다. 다시 시도해 주세요.',
    'Failed to update permissions. Please try again.': '권한을 업데이트하지 못했습니다. 다시 시도해 주세요.',
    'Workspaces': '작업 공간',
    'Folders these agents can access.': '이 에이전트가 접근할 수 있는 폴더입니다.',
    'Access grants': '접근 권한',
    'Commands and files these agents can use.': '이 에이전트가 사용할 수 있는 명령어와 파일입니다.',
    'needs a few details from you before it can run.': '실행하기 전에 몇 가지 추가 정보가 필요합니다.',
    'Are you sure you want to delete': '다음 항목을 삭제하시겠습니까:',
    '? This action cannot be undone.': '? 이 작업은 되돌릴 수 없습니다.',
    'already exists.': '이미 존재합니다.',
    '" not found.': '" 작업을 찾을 수 없습니다.',
    'Back to': '돌아가기:',
    'Back to Automations': '자동화 목록으로 돌아가기',
    'Back to Scheduled Tasks': '예약 작업 목록으로 돌아가기',

    // Permission Widget 추가분
    'Always allow': '항상 허용',
    'Allow Once': '이번만 허용',
    'Allow This Conversation': '이 대화에서 허용',
    'Allow Conversation': '대화에서 허용',
    'Deny': '거부',
    'Requires manual confirmation.': '수동 확인이 필요합니다.',
    'Edit permission target': '권한 대상 편집',
    'Add folder': '폴더 추가',
    'Add value': '값 추가',
    'All paths (*)': '모든 경로 (*)',
    'All commands (*)': '모든 명령어 (*)',
    'All URLs (*)': '모든 URL (*)',
    'All tools (*)': '모든 도구 (*)',
    'All MCP actions (*)': '모든 MCP 작업 (*)',
    'No workspace folders open': '열려 있는 작업 공간 폴더가 없습니다',
    'Allow access to this resource?': '이 리소스에 대한 접근을 허용하시겠습니까?',
    'Allow reading this URL?': '이 URL 읽기를 허용하시겠습니까?',
    'Allow executing actions on this URL?': '이 URL에서의 작업 실행을 허용하시겠습니까?',
    'Allow using this MCP tool?': '이 MCP 도구 사용을 허용하시겠습니까?',
    'Allow a one-time administrator (UAC) elevation?': '일회성 관리자 권한(UAC) 승격을 허용하시겠습니까?',
    'Save rule to always allow read access to this path?': '이 경로의 읽기 접근을 항상 허용하도록 규칙을 저장하시겠습니까?',
    'Save rule to always allow write access to this path?': '이 경로의 쓰기 접근을 항상 허용하도록 규칙을 저장하시겠습니까?',
    'Save rule to always allow reading this URL?': '이 URL 읽기를 항상 허용하도록 규칙을 저장하시겠습니까?',
    'Save rule to always allow executing actions on this URL?': '이 URL에서의 작업 실행을 항상 허용하도록 규칙을 저장하시겠습니까?',
    'Save rule to always allow running this command?': '이 명령어 실행을 항상 허용하도록 규칙을 저장하시겠습니까?',
    'Save rule to always allow running this command outside the sandbox?': '샌드박스 외부에서 이 명령어 실행을 항상 허용하도록 규칙을 저장하시겠습니까?',
    'Save rule to always allow using this MCP tool?': '이 MCP 도구 사용을 항상 허용하도록 규칙을 저장하시겠습니까?',
    'Save rule to always allow a one-time administrator (UAC) elevation?': '일회성 관리자 권한(UAC) 승격을 항상 허용하도록 규칙을 저장하시겠습니까?',
    'Save rule to always allow access to this resource?': '이 리소스에 대한 접근을 항상 허용하도록 규칙을 저장하시겠습니까?',
    'Yes, save rule in this conversation': '예, 이 대화에 규칙을 저장합니다',
    'Yes, save rule in this project': '예, 이 프로젝트에 규칙을 저장합니다',
    'Yes, save rule when not in a project': '예, 프로젝트 외부일 때 규칙을 저장합니다',
    'Yes, save rule globally': '예, 전역 규칙으로 저장합니다',
    'Yes, and always allow when not in a project': '예, 프로젝트 외부일 때 항상 허용합니다',

    // Ask Question / Survey / Placeholder 추가분
    'Something else (optional)': '기타 의견 (선택 사항)',
    'Select a value': '값 선택',
    'Select an option': '옵션 선택',
    'Open Automations': '자동화 열기',
    'Open Scheduled Tasks': '예약 작업 열기',
    'Open project settings': '프로젝트 설정 열기',
    'Edit task title': '작업 제목 편집',
    'Enter scheduled task name...': '예약 작업 이름 입력...',
    'Queued Messages': '대기 중인 메시지',
    'Sends after agent finishes working': '에이전트 작업이 끝나면 전송됩니다',
    'See all': '모두 보기',
    'Full View': '전체 보기',
    'Message from Parent Agent': '상위 에이전트의 메시지',
    'Message from Subagent': '서브에이전트의 메시지',
    'Tool arguments': '도구 인자',
    'Tool Arguments': '도구 인자',
    'Tool Output': '도구 출력',
    'Tool output': '도구 출력',
    'Hook Json PreInvocation': '훅 실행 전 (PreInvocation)',
    'Hook Json PostInvocation': '훅 실행 후 (PostInvocation)',
    'Hook Json Stop': '훅 종료 (Stop)',
    'Hook Json UserPromptSubmit': '훅 프롬프트 제출 (UserPromptSubmit)',

    // Antigravity Custom MCP Server Manager (#agy-mcp-manager-modal-backdrop & Customizations injected buttons)
    'Antigravity Custom MCP Server Manager': 'Antigravity 커스텀 MCP 서버 매니저',
    '🔌 Antigravity Custom MCP Server Manager': '🔌 Antigravity 커스텀 MCP 서버 매니저',
    'Native RPC Bridge': '네이티브 RPC 브리지',
    'Close MCP Manager': 'MCP 매니저 닫기',
    'Servers & Tools': '서버 및 도구',
    '+ Add / Edit Server': '+ 서버 추가 / 편집',
    '{ } Raw mcp_config.json': '{ } mcp_config.json 원문',
    '+ Custom MCP': '+ 커스텀 MCP',
    'Add or manage custom MCP servers in ~/.gemini/config/mcp_config.json':
      '~/.gemini/config/mcp_config.json에서 커스텀 MCP 서버 추가 및 관리',
    'Custom Stdio (npx / uvx / node / python) or HTTP MCP server:':
      '커스텀 Stdio (npx / uvx / node / python) 또는 HTTP MCP 서버:',
    '+ Add Custom MCP Server': '+ 사용자 지정 MCP 서버 추가',
    'Add Custom MCP Server': '사용자 지정 MCP 서버 추가',
    'Add or Edit Custom MCP Server': '사용자 지정 MCP 서버 추가 또는 수정',
    'Manage Custom Servers': '커스텀 서버 관리',
    'Manage Servers': '서버 목록 관리',
    '{ } Edit mcp_config.json': '{ } mcp_config.json 편집',
    '⚡ Quick Auto-Add (Enter MCP Server URL, GitHub/npm Address, Command, or JSON):':
      '⚡ 빠른 자동 추가 (MCP 서버 URL, GitHub/npm 주소, 명령어 또는 JSON 입력):',
    'https://mcp.example.com/mcp, https://github.com/owner/repo, @playwright/mcp, or npx -y ...':
      'https://mcp.example.com/mcp, https://github.com/owner/repo, @playwright/mcp 또는 npx -y ...',
    'Auto-Add & Connect': '자동 추가 및 연결',
    'Auto-Fill Form': '폼 자동 채우기',
    '↻ Refresh All Servers': '↻ 모든 서버 새로고침',
    'No custom MCP servers configured yet. Click "+ Add Custom MCP Server" to register a local Stdio or remote HTTP MCP server.':
      '아직 설정된 커스텀 MCP 서버가 없습니다. "+ 커스텀 MCP 서버 추가"를 클릭해 로컬 Stdio 또는 원격 HTTP MCP 서버를 등록하세요.',
    'READY': '준비됨',
    'PENDING': '대기 중',
    'ERROR': '오류',
    'DISABLED': '비활성',
    'CONFIGURED': '설정됨',
    'Plugin': '플러그인',
    '↻ Restart': '↻ 재시작',
    '(managed by plugin)': '(플러그인에서 관리됨)',
    '(empty command)': '(빈 명령어)',
    'Quick Preset Templates (Click to prefill):': '빠른 프리셋 템플릿 (클릭 시 자동 입력):',
    '📁 Filesystem': '📁 파일시스템 (Filesystem)',
    '🧠 Memory': '🧠 메모리 (Memory)',
    '🌐 Fetch': '🌐 웹 가져오기 (Fetch)',
    '☁️ Remote HTTP': '☁️ 원격 HTTP (Remote HTTP)',
    'Local directory read/write/search access via official MCP Filesystem server.':
      '공식 MCP Filesystem 서버를 통한 로컬 디렉터리 읽기/쓰기/검색 접근.',
    'Persistent knowledge graph memory server.': '지속형 지식 그래프 메모리 서버.',
    'Web page fetching and HTML-to-markdown conversion.': '웹 페이지 가져오기 및 HTML-마크다운 변환.',
    'GitHub repository, issue, PR, and search integration.': 'GitHub 저장소, 이슈, PR 및 검색 연동.',
    'Read-only schema inspection and SQL query execution for PostgreSQL.':
      'PostgreSQL 읽기 전용 스키마 조회 및 SQL 쿼리 실행.',
    'SQLite database query and business insight memo server.':
      'SQLite 데이터베이스 쿼리 및 비즈니스 인사이트 메모 서버.',
    'Browser automation via Playwright MCP server.': 'Playwright MCP 서버를 통한 브라우저 자동화.',
    'Streamable HTTP remote MCP endpoint (MCP spec 2025-03-26).':
      'Streamable HTTP 원격 MCP 엔드포인트 (MCP 사양 2025-03-26).',
    'Server Name (Optional — auto-filled from URL/Command)':
      '서버 이름 (선택 사항 — URL/명령어에서 자동 입력)',
    'Auto-detected if left blank (e.g. filesystem, github)':
      '비워 두면 자동 감지됨 (예: filesystem, github)',
    'Transport Type': '전송 방식 (Transport)',
    'Stdio (Local Process: npx / uvx / node / python / docker)':
      'Stdio (로컬 프로세스: npx / uvx / node / python / docker)',
    'Streamable HTTP / Remote URL': 'Streamable HTTP / 원격 URL',
    'Remote MCP Server URL (http:// or https://)': '원격 MCP 서버 URL (http:// 또는 https://)',
    'HTTP Headers (One "Header: Value" per line or JSON object)':
      'HTTP 헤더 (줄당 하나의 "Header: Value" 또는 JSON 객체)',
    'Command Executable': '실행 명령어 (Executable)',
    'Working Directory (cwd, optional)': '작업 디렉터리 (cwd, 선택 사항)',
    'e.g. D:/projects/my-server': '예: D:/projects/my-server',
    'Arguments (One argument per line, or JSON array ["arg1", "arg2"])':
      '인자 (줄당 하나의 인자 또는 JSON 배열 ["arg1", "arg2"])',
    'Environment Variables (One KEY=VALUE per line, or JSON object)':
      '환경 변수 (줄당 하나의 KEY=VALUE 또는 JSON 객체)',
    'Save as disabled initially': '초기에 비활성화 상태로 저장',
    'Save & Connect Server': '서버 저장 및 연결',
    'Open in Explorer': '탐색기에서 열기',
    'Format JSON': 'JSON 정렬',
    'Save mcp_config.json & Refresh': 'mcp_config.json 저장 및 새로고침',
    'Refreshing MCP servers...': 'MCP 서버 새로고침 중...',
    'MCP servers refreshed.': 'MCP 서버가 새로고침되었습니다.',
    'Formatted JSON.': 'JSON 형식을 정렬했습니다.',
    'Saved mcp_config.json and refreshed MCP servers.':
      'mcp_config.json을 저장하고 MCP 서버를 새로고침했습니다.',
    'Failed to save server': '서버 저장에 실패했습니다',
    'Please enter an MCP server URL, package name, command, or JSON snippet.':
      'MCP 서버 URL, 패키지 이름, 명령어 또는 JSON 조각을 입력해 주세요.',
    'Invalid URL format.': '잘못된 URL 형식입니다.',
    'Could not recognize MCP server address or command.':
      'MCP 서버 주소 또는 명령어를 인식할 수 없습니다.',
    'Server name is required (e.g. "filesystem" or "my-mcp-server").':
      '서버 이름은 필수입니다 (예: "filesystem" 또는 "my-mcp-server").',
    'Server name may only contain letters, numbers, hyphens (-), underscores (_), and dots (.).':
      '서버 이름에는 영문자, 숫자, 하이픈(-), 밑줄(_), 마침표(.)만 사용할 수 있습니다.',
    'Remote MCP Server URL is required for Streamable HTTP transport.':
      'Streamable HTTP 전송 방식에는 원격 MCP 서버 URL이 필수입니다.',
    'Remote MCP Server URL must start with http:// or https://.':
      '원격 MCP 서버 URL은 http:// 또는 https://로 시작해야 합니다.',
    'Executable command is required for Stdio transport (e.g. "npx", "node", "uvx").':
      'Stdio 전송 방식에는 실행 명령어가 필수입니다 (예: "npx", "node", "uvx").',
    'MCP config root must be a JSON object.': 'MCP 설정 최상위 루트는 JSON 객체여야 합니다.',
    '"mcpServers" must be a JSON object mapping server names to configurations.':
      '"mcpServers"는 서버 이름을 설정에 매핑하는 JSON 객체여야 합니다.',
    // Antigravity Custom MCP Server Manager v1.2.0 (Edit Popup & Authentication UI)
    'Edit Custom MCP Server & Authentication': '커스텀 MCP 서버 설정 및 인증 수정',
    '⚙️ Edit Custom MCP Server & Authentication': '⚙️ 커스텀 MCP 서버 설정 및 인증 수정',
    'Custom Config': '커스텀 설정',
    'Close Edit Popup': '수정 팝업 닫기',
    'Select Custom MCP Server to Edit:': '수정할 커스텀 MCP 서버 선택:',
    '+ New Custom MCP Server': '+ 새 커스텀 MCP 서버',
    '🔐 Authentication Settings (Bearer Token / API Key / Basic / OAuth)':
      '🔐 인증 설정 (Bearer 토큰 / API Key / Basic / OAuth)',
    'None (No authentication)': '없음 (인증 미사용)',
    'Bearer Token (Authorization: Bearer <token>)': 'Bearer 토큰 (Authorization: Bearer <token>)',
    'API Key Header (X-API-Key or Custom Header)': 'API Key 헤더 (X-API-Key 또는 커스텀 헤더)',
    'Basic Auth (Username & Password)': 'Basic 인증 (아이디 및 비밀번호)',
    'Native OAuth / Browser Sign-In': '네이티브 OAuth / 브라우저 로그인',
    'Bearer Token (Automatically sets "Authorization: Bearer <token>" header)':
      'Bearer 토큰 ("Authorization: Bearer <token>" 헤더 자동 설정)',
    'Auth Token (Automatically sets MCP_AUTH_TOKEN environment variable)':
      '인증 토큰 (MCP_AUTH_TOKEN 환경 변수 자동 설정)',
    'Auth Header / Env Key Name': '인증 헤더 / 환경 변수 키 이름',
    'X-API-Key or Authorization': 'X-API-Key 또는 Authorization',
    'API Key / Secret Value': 'API Key / 비밀값',
    'Username': '아이디',
    'Password': '비밀번호',
    'Show': '표시',
    'Hide': '숨김',
    '🌐 Open Auth URL in Browser': '🌐 브라우저에서 인증 URL 열기',
    'Submit Auth Code': '인증 코드 제출',
    'Disconnect OAuth': 'OAuth 연결 해제',
    'Delete Server': '서버 삭제',
    'Deleted custom server.': '커스텀 서버를 삭제했습니다.',
    'Open Full Manager': '전체 매니저 열기',
    'Save & Reconnect': '저장 및 재연결',
    '⚙️ Edit Custom MCP': '⚙️ 커스텀 MCP 수정',
    '⚙️ Edit Custom MCP Settings': '⚙️ 커스텀 MCP 설정 수정',
    'Edit custom MCP server settings & authentication': '커스텀 MCP 서버 설정 및 인증 수정',
    '🔑 MCP Auth Settings': '🔑 MCP 인증 설정',
    '⚙️ Edit Settings': '⚙️ 설정 수정',
    '🔑 Authenticate': '🔑 인증 설정',
    '🔑 Configure Auth / Edit Settings': '🔑 인증 설정 / 설정 수정',
    '+ Custom MCP Server': '+ 커스텀 MCP 서버',
    '🔑 Optional Bearer Token / API Key': '🔑 선택적 Bearer 토큰 / API Key',
    'Paste Bearer token here (e.g. eyJhbGci... or mcp_secret_...)':
      '여기에 Bearer 토큰을 붙여넣으세요 (예: eyJhbGci...)',
    'Enter API key value...': 'API Key 값을 입력하세요...',
    'Enter authorization code...': '인증 코드를 입력하세요...',
    'OAuth status: Authenticated token is active on host.':
      'OAuth 상태: 호스트에 인증된 토큰이 활성화되어 있습니다.',
    'OAuth URL provided by server. Click "Open Auth URL in Browser", sign in, and paste the authorization code below.':
      '서버에서 OAuth URL을 제공했습니다. "브라우저에서 인증 URL 열기"를 클릭해 로그인한 뒤 아래에 인증 코드를 붙여넣으세요.',
    'If this remote MCP server uses Bearer tokens instead of dynamic OAuth registration, switch Authentication Type to "Bearer Token".':
      '이 원격 MCP 서버가 동적 OAuth 등록 대신 Bearer 토큰을 사용하는 경우 인증 유형을 "Bearer 토큰"으로 전환하세요.',
    'Opened OAuth authorization page in browser. Paste the resulting code below.':
      '브라우저에서 OAuth 인증 페이지를 열었습니다. 발급된 인증 코드를 아래에 붙여넣으세요.',
    'Save the server first or enter a Server Name before submitting an OAuth code.':
      'OAuth 코드를 제출하기 전에 먼저 서버를 저장하거나 서버 이름을 입력하세요.',
    'Failed to complete OAuth.': 'OAuth 인증을 완료하지 못했습니다.',
    'Failed to disconnect OAuth.': 'OAuth 연결을 해제하지 못했습니다.',
    'Server name and authorization code are required.': '서버 이름과 인증 코드가 필요합니다.',
    'Host OAuth service (completeMcpOAuth) is not available.':
      '호스트 OAuth 서비스(completeMcpOAuth)를 사용할 수 없습니다.',
    'Host OAuth service (disconnectMcpOAuth) is not available.':
      '호스트 OAuth 서비스(disconnectMcpOAuth)를 사용할 수 없습니다.',
    'Server name is required.': '서버 이름은 필수입니다.',
    'No matching HTTP custom servers found to update authentication.':
      '인증을 업데이트할 일치하는 HTTP 커스텀 서버가 없습니다.',
    // Antigravity Custom MCP Server Manager v1.4.0 (OAuth Portal, Settings Tab & Top Menu Bar)
    '⚙️ Edit Custom MCP Server Settings': '⚙️ 사용자 지정 MCP 서버 설정 수정',
    '⚙️ Edit Server Settings': '⚙️ 서버 설정 수정',
    '⚙️ Edit Settings / Connect OAuth': '⚙️ 설정 수정 / OAuth 연결',
    '⚙️ OAuth Settings': '⚙️ OAuth 설정',
    '🔗 OAuth / Auth Settings': '🔗 OAuth / 인증 설정',
    '🔗 Connect OAuth / Auth': '🔗 OAuth 연결 / 인증',
    'OAuth & Custom MCP': 'OAuth 및 사용자 지정 MCP',
    '↻ Refresh': '↻ 새로고침',
    '+ Add Custom MCP Server (New Custom MCP Server)': '+ 사용자 지정 MCP 서버 추가 (새 커스텀 MCP 서버)',
    'Register, authenticate, and manage remote OAuth MCP portals and local (Stdio) custom MCP servers.':
      '원격 OAuth MCP 포털 및 로컬(Stdio) 사용자 지정 MCP 서버를 등록, 인증 및 관리합니다.',
    'Custom OAuth MCP portal (https://.../mcp) or local Stdio (npx / uvx / node / python) server:':
      '사용자 지정 OAuth MCP 포털(https://.../mcp) 또는 로컬 Stdio(npx / uvx / node / python) 서버:',
    '⚡ Quick Auto-Add (Enter Remote OAuth MCP URL, GitHub/npm Address, Command, or JSON):':
      '⚡ 빠른 자동 추가 (원격 OAuth MCP URL, GitHub/npm 주소, 명령어 또는 JSON 입력):',
    'https://mcp.example.com/mcp, https://github.com/owner/repo, @playwright/mcp, or npx -y ...':
      'https://mcp.example.com/mcp, https://github.com/owner/repo, @playwright/mcp 또는 npx -y ...',
    'No custom MCP servers configured yet. Click "+ Add Custom MCP Server" to register a remote OAuth MCP portal or local Stdio server.':
      '아직 설정된 사용자 지정 MCP 서버가 없습니다. "+ 사용자 지정 MCP 서버 추가"를 클릭해 원격 OAuth MCP 포털 또는 로컬 Stdio 서버를 등록하세요.',
    '☁️ Remote OAuth MCP': '☁️ 원격 OAuth MCP',
    'Remote Streamable HTTP / OAuth MCP portal (MCP spec 2025-03-26).':
      '원격 Streamable HTTP / OAuth MCP 포털 (MCP 사양 2025-03-26).',
    'Name': '이름',
    'Custom tool name (auto-generated from Server URL if left blank)':
      '사용자 지정 도구 이름 (비워 두면 서버 URL에서 자동 생성됨)',
    'Description (Optional)': '설명 (선택 사항)',
    'Briefly describe what this server does': '이 서버의 역할을 간단히 입력하세요',
    'Connection': '연결',
    'Server URL': '서버 URL',
    'Local / Tunnel (Stdio)': '로컬 / 터널 (Stdio)',
    'Authentication': '인증',
    'No Authentication': '인증 없음',
    'OAuth or No Authentication': 'OAuth 또는 인증 없음',
    'Automatically detects MCP portal OAuth settings and opens the sign-in window after saving.':
      '저장 후 MCP 포털의 OAuth 설정을 자동으로 감지하여 로그인 창을 엽니다.',
    'Advanced OAuth Settings': '고급 OAuth 설정',
    'Review auto-detected OAuth settings or enter custom credentials, select client configuration mode, and set default scopes.':
      '자동 감지된 OAuth 설정을 확인하거나 직접 자격 증명을 입력하고, 클라이언트 설정 방식 및 기본 권한 범위(Scopes)를 지정합니다.',
    'Client Configuration': '클라이언트 설정 방식',
    'Automatic Discovery & Dynamic Client Registration': '자동 감지 및 동적 클라이언트 등록',
    'Custom Client ID & Secret': 'Client ID 및 Secret 직접 입력',
    'Client ID': 'Client ID',
    'OAuth Client ID': 'OAuth Client ID',
    'Client Secret (Optional)': 'Client Secret (선택 사항)',
    'OAuth Client Secret (optional)': 'OAuth Client Secret (선택 사항)',
    'Default Scopes (Optional)': '기본 권한 범위 / Scopes (선택 사항)',
    'Auto-detected (e.g. openid profile mcp:tools)': '자동 감지됨 (예: openid profile mcp:tools)',
    'Enter authorization code manually (optional)...': '인증 코드 직접 입력 (선택 사항)...',
    '⚠️ Custom MCP servers carry risks. Only connect to MCP servers you trust.':
      '⚠️ 사용자 지정 MCP 서버는 보안 위험이 있을 수 있습니다. 신뢰할 수 있는 MCP 서버만 연결하세요.',
    'Create & Connect': '플러그인으로 생성',
    'Close OAuth Connect Modal': 'OAuth 연결 모달 닫기',
    'If the browser completes callback automatically, this window closes automatically — or paste the authorization code below:':
      '브라우저에서 콜백이 자동 완료되면 이 창이 자동으로 닫히며, 수동 코드가 발급된 경우 아래에 붙여넣으세요:',
    'Paste authorization code here (if prompted)...': '여기에 인증 코드를 붙여넣으세요 (수동 입력 시)...',
    'Submit Code': '코드 제출',
    'Opening OAuth sign-in page in your browser...': '브라우저에서 OAuth 로그인 페이지를 여는 중...',
    'Browser sign-in window opened. Complete authentication in your browser (status updates automatically).':
      '브라우저 로그인 창이 열렸습니다. 브라우저에서 인증을 완료하세요 (완료 시 상태가 자동 갱신됩니다).',
    'OAuth authentication completed!': 'OAuth 인증이 완료되었습니다!',
    'Please enter the authorization code from your browser.': '브라우저에서 발급된 인증 코드를 입력해 주세요.',
    'No OAuth URL is currently reported by the server. Click below to refresh and detect OAuth settings.':
      '현재 서버에서 보고된 OAuth URL이 없습니다. 아래 버튼을 눌러 새로고침하고 OAuth 설정을 감지하세요.',
    'Detecting OAuth settings from server...': '서버에서 OAuth 설정을 감지하는 중...',
    'Still no OAuth prompt from server. Check the Server URL or switch to Custom Client ID.':
      '서버에서 OAuth 요청이 감지되지 않았습니다. 서버 URL을 확인하거나 Client ID 직접 입력을 사용해 보세요.',
    '↻ Detect OAuth & Sign In': '↻ OAuth 감지 및 로그인',
    'Configure Custom Client ID / Advanced OAuth': 'Client ID 직접 입력 / 고급 OAuth 설정',
    'Add or manage custom OAuth / Stdio MCP servers': '사용자 지정 OAuth / Stdio MCP 서버 추가 및 관리',

    // Antigravity Web Host Shell (boq-jetski: m=SIH86 HomeComponent, m=PGmR6b RemoteControlComponent, m=Mc2QKe RemoteAgentsComponent)
    'Welcome to Antigravity': 'Antigravity에 오신 것을 환영합니다',
    'The agentic development platform': '에이전트 기반 개발 플랫폼',
    'Google Account': 'Google 계정',
    'Signed in with': '로그인 계정:',
    'Continue': '계속',
    'Switch account': '계정 전환',
    'Use business account': '비즈니스 계정 사용',
    'Sign in with business account': '비즈니스 계정으로 로그인',
    'Terms of Service': '서비스 약관',
    'Privacy Policy': '개인정보처리방침',
    'Remote Control': '원격 제어',
    'Remote Control Instances': '원격 제어 인스턴스',
    'Remote Conversations': '원격 대화',
    'Remote agent': '원격 에이전트',
    'New environment for each conversation': '대화마다 새 환경 생성',
    'Connect your first instance': '첫 번째 인스턴스 연결',
    'Run Antigravity on your machine and drive it from here.': 'PC에서 Antigravity를 실행하고 여기에서 원격으로 제어하세요.',
    'Download Antigravity': 'Antigravity 다운로드',
    'View the docs': '문서 보기',
    'Using the CLI?': 'CLI를 사용하시나요?',
    'CLI guide': 'CLI 가이드',
    'Loading instances...': '인스턴스 불러오는 중...',
    'Failed to load instances': '인스턴스를 불러오지 못했습니다',
    'Dismiss': '닫기',
    'Dismiss notification': '알림 닫기',
    'Instance disconnected': '인스턴스 연결 끊김',
    'Waiting for connection or Wi-Fi to resume...': '연결 또는 Wi-Fi 복구를 기다리는 중...',
    'Connecting to instance...': '인스턴스에 연결하는 중...',
    'No instance selected': '선택된 인스턴스 없음',
    'Instance unavailable': '인스턴스를 사용할 수 없음',
    'Device access revoked': '기기 접근 권한이 해제됨',
    'Go to Instance Selector': '인스턴스 선택 화면으로 이동',
    'Reload Instances': '인스턴스 새로고침',
    'Install as App': '앱으로 설치',
    'Send feedback': '의견 보내기',
    'Dev Debug Panel': '개발 디버그 패널',
    'Continue on': '다른 기기에서 계속',
    'Reconnect': '다시 연결',
    'Offline': '오프라인',
    'Online': '온라인',
    'Last active': '마지막 활동',
    'Updated just now': '방금 업데이트됨',
    'Remove instance': '인스턴스 제거',
    'More options': '더보기 옵션',
    'Create Project': '프로젝트 생성',
    'New Remote Project': '새 원격 프로젝트',
    'Project Name': '프로젝트 이름',
    'Repository URL': '저장소 URL',
    'Open in Hub': '허브에서 열기',
    'Switch Roles': '역할 전환',
    'By continuing, you agree to the': '계속 진행하면 다음에 동의하게 됩니다:',
    'and acknowledge the': '및 확인:',
  };

  function formatDurationKo(rawDur) {
    if (!rawDur) return rawDur;
    let s = rawDur.trim();
    if (s === '<1s' || s === '< 1s') return '1초 미만';
    s = s.replace(/(\d+)\s*h(?:ours?|r)?\b/gi, '$1시간');
    s = s.replace(/(\d+)\s*m(?:in(?:ute)?s?)?\b/gi, '$1분');
    s = s.replace(/(\d+)\s*s(?:ec(?:ond)?s?)?\b/gi, '$1초');
    return s;
  }

  function translateToolClause(clause) {
    const c = clause.trim();
    const lower = c.toLowerCase();
    if (lower === 'explored') return '탐색함';
    if (lower === 'exploring') return '탐색 중';
    if (lower === 'explored files' || lower === 'explored file') return '파일 탐색';
    if (lower === 'exploring files' || lower === 'exploring file') return '파일 탐색 중';
    if (lower === 'explored artifacts' || lower === 'explored artifact') return '산출물 탐색';
    if (lower === 'exploring artifacts' || lower === 'exploring artifact') return '산출물 탐색 중';
    if (lower === 'ran commands' || lower === 'ran command') return '명령 실행';
    if (lower === 'running commands' || lower === 'running command') return '명령 실행 중';
    if (lower === 'edited files' || lower === 'edited file') return '파일 수정';
    if (lower === 'editing files' || lower === 'editing file') return '파일 수정 중';
    if (lower === 'edited artifacts' || lower === 'edited artifact') return '산출물 수정';
    if (lower === 'editing artifacts' || lower === 'editing artifact') return '산출물 수정 중';
    if (lower === 'created files' || lower === 'created file') return '파일 생성';
    if (lower === 'creating files' || lower === 'creating file') return '파일 생성 중';
    if (lower === 'created artifacts' || lower === 'created artifact') return '산출물 생성';
    if (lower === 'creating artifacts' || lower === 'creating artifact') return '산출물 생성 중';
    if (lower === 'deleted files' || lower === 'deleted file') return '파일 삭제';
    if (lower === 'deleting files' || lower === 'deleting file') return '파일 삭제 중';
    if (lower === 'deleted artifacts' || lower === 'deleted artifact') return '산출물 삭제';
    if (lower === 'deleting artifacts' || lower === 'deleting artifact') return '산출물 삭제 중';
    if (lower === 'read files' || lower === 'read file') return '파일 읽기';
    if (lower === 'reading files' || lower === 'reading file') return '파일 읽는 중';
    if (lower === 'searched web' || lower === 'searching web') return '웹 검색';
    if (lower === 'searched files' || lower === 'searching files') return '파일 검색';
    if (lower === 'analyzed files' || lower === 'analyzing files') return '파일 분석';

    let m = c.match(/^Read\s+(\d+)\s+files?$/i);
    if (m) return `파일 ${m[1]}개 읽음`;
    m = c.match(/^Edited\s+(\d+)\s+files?$/i);
    if (m) return `파일 ${m[1]}개 수정함`;
    m = c.match(/^Created\s+(\d+)\s+files?$/i);
    if (m) return `파일 ${m[1]}개 생성함`;
    m = c.match(/^Deleted\s+(\d+)\s+files?$/i);
    if (m) return `파일 ${m[1]}개 삭제함`;
    m = c.match(/^Ran\s+(\d+)\s+commands?$/i);
    if (m) return `명령 ${m[1]}개 실행함`;
    m = c.match(/^Explored\s+(\d+)\s+files?$/i);
    if (m) return `파일 ${m[1]}개 탐색함`;
    m = c.match(/^Searched\s+(\d+)\s+files?$/i);
    if (m) return `파일 ${m[1]}개 검색함`;
    m = c.match(/^Analyzed\s+(\d+)\s+files?$/i);
    if (m) return `파일 ${m[1]}개 분석함`;
    m = c.match(/^Listed\s+(\d+)\s+(?:files?|directories|folders?)$/i);
    if (m) return `항목 ${m[1]}개 목록 조회함`;

    // Dynamic single-target tool group labels (e.g. "Reading http-engine-client.ts", "Editing App.tsx", "Listing src/")
    const dynamicVerbMap = [
      [/^Reading\s+(.+)$/i, '읽는 중'],
      [/^Read\s+(.+)$/i, '읽음'],
      [/^Editing\s+(.+)$/i, '수정 중'],
      [/^Edited\s+(.+)$/i, '수정함'],
      [/^Creating\s+(.+)$/i, '생성 중'],
      [/^Created\s+(.+)$/i, '생성함'],
      [/^Deleting\s+(.+)$/i, '삭제 중'],
      [/^Deleted\s+(.+)$/i, '삭제함'],
      [/^Listing\s+(.+)$/i, '목록 조회 중'],
      [/^Listed\s+(.+)$/i, '목록 조회함'],
      [/^Searching\s+(?:for\s+)?(.+)$/i, '검색 중'],
      [/^Searched\s+(?:for\s+)?(.+)$/i, '검색함'],
      [/^Analyzing\s+(.+)$/i, '분석 중'],
      [/^Analyzed\s+(.+)$/i, '분석함'],
      [/^Running\s+(.+)$/i, '실행 중'],
      [/^Ran\s+(.+)$/i, '실행함'],
      [/^Viewing\s+(.+)$/i, '확인 중'],
      [/^Viewed\s+(.+)$/i, '확인함'],
      [/^Fetching\s+(.+)$/i, '가져오는 중'],
      [/^Fetched\s+(.+)$/i, '가져옴'],
      [/^Exploring\s+(.+)$/i, '탐색 중'],
      [/^Explored\s+(.+)$/i, '탐색함'],
    ];
    for (const [re, koVerb] of dynamicVerbMap) {
      const dm = c.match(re);
      if (dm && dm[1]) {
        return `${koVerb}: ${dm[1].trim()}`;
      }
    }
    return null;
  }

  function translateStaticUiSync(raw) {
    if (!raw) return null;
    const t = raw.trim();
    if (!t) return null;

    if (Object.prototype.hasOwnProperty.call(STATIC_UI_MAP, t)) {
      return STATIC_UI_MAP[t];
    }

    // Multiline Terminal Command Auto Execution description
    if (t.startsWith('Controls whether terminal commands require your approval before running.')) {
      return '터미널 명령어 실행 전 사용자 승인 필요 여부를 제어합니다.\n\n참고: 이 설정 변경은 새로 보내는 메시지부터 적용되며, 진행 중인 응답에는 이전 설정값이 사용됩니다.';
    }

    // Permission approval dialog headers & options
    let m = t.match(/^Allow\s+(.+?)\?$/i);
    if (m) return `${m[1]} 작업을 허용하시겠습니까?`;

    m = t.match(/^Yes,\s*allow\s+this\s+time$/i);
    if (m) return '예, 이번에만 허용';

    m = t.match(/^Yes,\s*and\s+always\s+allow\s+access\s+to\s+(.+?)\s+in\s+this\s+conversation$/i);
    if (m) return `예, 이 대화에서 ${m[1]} 접근을 항상 허용`;

    m = t.match(/^Yes,\s*and\s+always\s+allow\s+access\s+to\s+(.+?)\s+in\s+this\s+project$/i);
    if (m) return `예, 이 프로젝트에서 ${m[1]} 접근을 항상 허용`;

    m = t.match(/^Yes,\s*and\s+always\s+allow\s+access\s+to\s+(.+?)\s+globally$/i);
    if (m) return `예, 모든 작업에서 ${m[1]} 접근을 항상 허용`;

    m = t.match(/^Yes,\s*and\s+always\s+allow\s+access\s+to\s+(.+)$/i);
    if (m) return `예, ${m[1]} 접근을 항상 허용`;

    m = t.match(/^Yes,\s*and\s+always\s+allow\s+(.+?)\s+in\s+this\s+conversation$/i);
    if (m) return `예, 이 대화에서 ${m[1]} 실행을 항상 허용`;

    m = t.match(/^Yes,\s*and\s+always\s+allow\s+(.+?)\s+in\s+this\s+project$/i);
    if (m) return `예, 이 프로젝트에서 ${m[1]} 실행을 항상 허용`;

    m = t.match(/^Yes,\s*and\s+always\s+allow\s+(.+?)\s+globally$/i);
    if (m) return `예, 모든 작업에서 ${m[1]} 실행을 항상 허용`;

    m = t.match(/^Yes,\s*and\s+always\s+allow\s+(.+)$/i);
    if (m) return `예, ${m[1]} 실행을 항상 허용`;

    m = t.match(/^Always\s+allow\s+(.+?)\s+in\s+this\s+conversation$/i);
    if (m) return `이 대화에서 ${m[1]} 항상 허용`;

    m = t.match(/^Always\s+allow\s+(.+?)\s+in\s+this\s+project$/i);
    if (m) return `이 프로젝트에서 ${m[1]} 항상 허용`;

    m = t.match(/^Always\s+allow\s+(.+)$/i);
    if (m) return `${m[1]} 항상 허용`;

    m = t.match(/^Inherits your Global Permissions when working\s+(.+)\.$/i);
    if (m) return `작업 시 전역 권한 설정을 그대로 상속합니다 (${m[1]}).`;

    // Automation test-run & permission configuration prompts
    m = t.match(
      /^Once enabled,\s*['"](.+?)['"]\s*will run in a project that inherits global permissions and presets,\s*and all other non-approved commands will be auto-denied\.\s*Would you like me to execute a test run now to configure its permissions properly so it can proceed successfully\?$/i
    );
    if (m) {
      return `활성화하면 '${m[1]}' 자동화는 전역 권한 및 프리셋을 상속하는 프로젝트에서 실행되며, 승인되지 않은 다른 모든 명령은 자동 거부됩니다. 원활하게 실행될 수 있도록 지금 테스트 실행을 진행하여 권한을 설정하시겠습니까?`;
    }

    m = t.match(/^No,\s*I'll review permissions and enable\s*['"](.+?)['"]\s*in the Automations dashboard\.?$/i);
    if (m) {
      return `아니요, 자동화 대시보드에서 직접 권한을 검토하고 '${m[1]}' 자동화를 활성화하겠습니다`;
    }

    m = t.match(/^Yes,\s*execute a test run now to configure permissions\.?$/i);
    if (m) {
      return '예, 지금 테스트 실행을 진행하여 권한을 설정합니다';
    }

    m = t.match(/^No\s+(automations|scheduled tasks|tasks|conversations|projects|skills|rules|plugins|results)\s+matching your search\.?$/i);
    if (m) {
      const nounMap = {
        'automations': '자동화',
        'scheduled tasks': '예약 작업',
        'tasks': '작업',
        'conversations': '대화',
        'projects': '프로젝트',
        'skills': '스킬',
        'rules': '규칙',
        'plugins': '플러그인',
        'results': '결과',
      };
      const koNoun = nounMap[m[1].toLowerCase()] || m[1];
      return `검색과 일치하는 ${koNoun} 항목이 없습니다`;
    }

    m = t.match(/^No\s+(automations|scheduled tasks|tasks|conversations|projects|skills|rules|plugins)\s+configured\.?$/i);
    if (m) {
      const nounMap = {
        'automations': '자동화',
        'scheduled tasks': '예약 작업',
        'tasks': '작업',
        'conversations': '대화',
        'projects': '프로젝트',
        'skills': '스킬',
        'rules': '규칙',
        'plugins': '플러그인',
      };
      const koNoun = nounMap[m[1].toLowerCase()] || m[1];
      return `설정된 ${koNoun} 항목이 없습니다.`;
    }

    m = t.match(/^Add\s+(automation|scheduled task|task|project|workspace)$/i);
    if (m) {
      const nounMap = {
        'automation': '자동화',
        'scheduled task': '예약 작업',
        'task': '작업',
        'project': '프로젝트',
        'workspace': '작업공간',
      };
      const koNoun = nounMap[m[1].toLowerCase()] || m[1];
      return `${koNoun} 추가`;
    }

    m = t.match(/^Are you sure you want to delete\s+(.+?)\??$/i);
    if (m) return `정말 ${m[1]} 항목을 삭제하시겠습니까?`;

    m = t.match(/^Agents created by\s+(.+)$/i);
    if (m) return `${m[1]}에서 생성한 에이전트`;

    m = t.match(/^Message from\s+(.+)$/i);
    if (m) return `${m[1]}의 메시지`;

    m = t.match(/^Message to\s+(.+)$/i);
    if (m) return `${m[1]}에게 보낸 메시지`;

    m = t.match(/^(.+?)\s+\(Experimental\)$/i);
    if (m) {
      const inner = translateStaticUiSync(m[1]) || m[1];
      return `${inner} (실험적 기능)`;
    }

    m = t.match(/^(?:\(Recommended\)|\(권장\))\s*(.+)$/i);
    if (m) {
      const inner = translateStaticUiSync(m[1]) || m[1];
      return `(권장) ${inner}`;
    }

    // "See all (12)"
    m = t.match(/^See all \((\d+)\)$/i);
    if (m) return `모두 보기 (${m[1]}개)`;

    m = t.match(/^(\d+)\s+subagents?\s+running$/i);
    if (m) return `서브에이전트 ${m[1]}개 실행 중`;

    m = t.match(/^(\d+)\s+tasks?\s+running$/i);
    if (m) return `작업 ${m[1]}개 실행 중`;

    // "Triggered 2 hours ago" / "Triggered Yesterday"
    m = t.match(/^Triggered\s+(.+)$/i);
    if (m) {
      const inner = translateStaticUiSync(m[1]) || m[1];
      return `${inner} 트리거됨`;
    }

    // "Set up <Name>" / "Review permissions for <Name>"
    m = t.match(/^Set up\s+(.+)$/i);
    if (m) return `${m[1]} 설정`;

    m = t.match(/^Review permissions for\s+(.+)$/i);
    if (m) return `${m[1]} 권한 검토`;

    // "<Name> needs a few details from you before it can run."
    m = t.match(/^(.+?)\s+needs a few details from you before it can run\.$/i);
    if (m) return `${m[1]} 실행 전에 몇 가지 추가 정보가 필요합니다.`;

    // "On top of those defaults, <Name> requests the access below."
    m = t.match(/^On top of those defaults,\s+(.+?)\s+requests the access below\.$/i);
    if (m) return `기본 권한 외에 ${m[1]}에서 아래 접근 권한을 추가로 요청합니다.`;

    // "Enable <automation|scheduled task>" / "Delete <automation|scheduled task>"
    m = t.match(/^Enable\s+(automation|scheduled task)$/i);
    if (m) return `${m[1].toLowerCase() === 'automation' ? '자동화' : '예약 작업'} 활성화`;

    m = t.match(/^Delete\s+(automation|scheduled task)$/i);
    if (m) return `${m[1].toLowerCase() === 'automation' ? '자동화' : '예약 작업'} 삭제`;

    // "Enter <field>..."
    m = t.match(/^Enter\s+(.+)\.\.\.$/i);
    if (m) {
      const inner = translateStaticUiSync(m[1]) || m[1];
      return `${inner} 입력...`;
    }

    // "Save rule to always allow <action>?"
    m = t.match(/^Save rule to always allow\s+(.+)\?$/i);
    if (m) return `${m[1]} 작업을 항상 허용하도록 규칙을 저장하시겠습니까?`;

    // "Yes, save rule for '<target>' in this conversation/in this project/when not in a project/globally"
    m = t.match(/^Yes, save rule for '(.+)' in this conversation$/i);
    if (m) return `예, 이 대화에서 '${m[1]}' 규칙을 저장합니다`;

    m = t.match(/^Yes, save rule for '(.+)' in this project$/i);
    if (m) return `예, 이 프로젝트에서 '${m[1]}' 규칙을 저장합니다`;

    m = t.match(/^Yes, save rule for '(.+)' when not in a project$/i);
    if (m) return `예, 프로젝트 외부일 때 '${m[1]}' 규칙을 저장합니다`;

    m = t.match(/^Yes, save rule for '(.+)' globally$/i);
    if (m) return `예, '${m[1]}' 규칙을 전역으로 저장합니다`;

    m = t.match(/^Yes, and always allow '(.+)' when not in a project$/i);
    if (m) return `예, 프로젝트 외부일 때 '${m[1]}' 실행을 항상 허용합니다`;

    // Permission disabled reason tooltips
    m = t.match(/^Conflicts with your configured Ask permission:\s*(.+)$/i);
    if (m) return `설정된 확인(Ask) 권한과 충돌합니다: ${m[1]}`;

    m = t.match(/^Requires manual confirmation:\s*(.+)$/i);
    if (m) return `수동 확인이 필요합니다: ${m[1]}`;

    // "<Label>, <N> grant(s)"
    m = t.match(/^(.+),\s*(\d+)\s+grants?$/i);
    if (m) {
      const inner = translateStaticUiSync(m[1]) || m[1];
      return `${inner}, 권한 ${m[2]}개`;
    }

    // MCP / tools count
    m = t.match(/^(\d+)\s+tools?\s+enabled$/i);
    if (m) return `도구 ${m[1]}개 활성화됨`;

    m = t.match(/^(\d+)\s+tools?\s+disabled$/i);
    if (m) return `도구 ${m[1]}개 비활성화됨`;

    m = t.match(/^(\d+)\s+tools?\s+available$/i);
    if (m) return `도구 ${m[1]}개 사용 가능`;

    m = t.match(/^(\d+)\s+servers?\s+enabled$/i);
    if (m) return `서버 ${m[1]}개 활성화됨`;

    // Antigravity Custom MCP Server Manager dynamic patterns
    m = t.match(/^Custom Servers:\s*(\d+)\s*\|\s*Active Runtime States:\s*(\d+)$/i);
    if (m) return `커스텀 서버: ${m[1]}개 | 활성 런타임 상태: ${m[2]}개`;

    m = t.match(/^Tools\s*\((\d+)\)\s*—\s*click a tool chip to enable\/disable it in mcp_config\.json:$/i);
    if (m) return `도구 (${m[1]}개) — 도구 칩을 클릭해 mcp_config.json에서 활성화/비활성화:`;

    m = t.match(/^Tools\s*\((\d+)\):$/i);
    if (m) return `도구 (${m[1]}개):`;

    m = t.match(/^Saving\s+(\d+)\s+MCP\s+servers\s*\((.+)\)\.\.\.$/i);
    if (m) return `MCP 서버 ${m[1]}개 저장 중 (${m[2]})...`;

    m = t.match(/^Automatically configured and connected\s+(\d+)\s+servers:\s*(.+)\.$/i);
    if (m) return `서버 ${m[1]}개를 자동으로 설정하고 연결했습니다: ${m[2]}.`;

    m = t.match(/^Auto-configuring\s+"(.+)"\.\.\.$/i);
    if (m) return `"${m[1]}" 자동 설정 중...`;

    m = t.match(/^Automatically added and connected\s+"(.+)"\.$/i);
    if (m) return `"${m[1]}" 서버를 자동으로 추가하고 연결했습니다.`;

    m = t.match(
      /^Auto-filled form for\s+"(.+)"\.\s*Review or add env vars below,\s*then click Save & Connect Server\.$/i
    );
    if (m) {
      return `"${m[1]}" 서버 폼을 자동으로 채웠습니다. 아래에서 환경 변수를 검토하거나 추가한 뒤 [서버 저장 및 연결]을 클릭하세요.`;
    }

    m = t.match(/^Server\s+"(.+)"\s+(enabled|disabled)\.$/i);
    if (m) return `"${m[1]}" 서버가 ${m[2].toLowerCase() === 'enabled' ? '활성화' : '비활성화'}되었습니다.`;

    m = t.match(/^Restarting\s+"(.+)"\.\.\.$/i);
    if (m) return `"${m[1]}" 재시작 중...`;

    m = t.match(/^Restarted\s+"(.+)"\.$/i);
    if (m) return `"${m[1]}" 서버를 재시작했습니다.`;

    m = t.match(/^Removed custom server\s+"(.+)"\.$/i);
    if (m) return `"${m[1]}" 커스텀 서버를 삭제했습니다.`;

    m = t.match(/^Tool\s+"(.+)"\s+on\s+"(.+)"\s+(enabled|disabled)\.$/i);
    if (m) {
      return `"${m[2]}" 서버의 "${m[1]}" 도구가 ${m[3].toLowerCase() === 'enabled' ? '활성화' : '비활성화'}되었습니다.`;
    }

    m = t.match(/^Loaded preset\s+"(.+)"\.\s*Review placeholders before saving\.$/i);
    if (m) {
      const inner = translateStaticUiSync(m[1]) || m[1];
      return `"${inner}" 프리셋을 불러왔습니다. 저장하기 전에 입력값을 확인하세요.`;
    }

    m = t.match(/^Saving\s+"(.+)"\s+to\s+mcp_config\.json\.\.\.$/i);
    if (m) return `mcp_config.json에 "${m[1]}" 저장 중...`;

    m = t.match(/^Saved and triggered reload for\s+"(.+)"\.$/i);
    if (m) return `"${m[1]}" 서버를 저장하고 다시 불러왔습니다.`;

    m = t.match(/^Failed to load MCP configuration:\s*(.+)$/i);
    if (m) return `MCP 설정을 불러오지 못했습니다: ${m[1]}`;

    m = t.match(/^Failed to\s+(toggle|delete)\s+"(.+)":\s*(.+)$/i);
    if (m) {
      return `"${m[2]}" 서버 ${m[1].toLowerCase() === 'toggle' ? '상태 전환' : '삭제'} 실패: ${m[3]}`;
    }

    m = t.match(/^Failed to toggle tool:\s*(.+)$/i);
    if (m) return `도구 상태 전환 실패: ${m[1]}`;

    m = t.match(/^Invalid JSON(?: input)?:\s*(.+)$/i);
    if (m) return `잘못된 JSON 형식: ${m[1]}`;

    m = t.match(/^Server\s+"(.+)"\s+configuration must be a JSON object\.$/i);
    if (m) return `"${m[1]}" 서버 설정은 JSON 객체여야 합니다.`;

    m = t.match(/^Server\s+"(.+)"\s+must specify either "command"\s*\(Stdio\)\s*or "url"\s*\(Streamable HTTP\)\.$/i);
    if (m) return `"${m[1]}" 서버는 "command"(Stdio) 또는 "url"(Streamable HTTP) 중 하나를 지정해야 합니다.`;

    m = t.match(/^Error:\s*(.+)$/i);
    if (m) return `오류: ${m[1]}`;

    // Antigravity Custom MCP Server Manager v1.2.0 dynamic patterns
    m = t.match(/^HTTP\s+(.+?)\s+\[🔑 Auth Header Configured\]$/i);
    if (m) return `HTTP ${m[1]}  [🔑 인증 헤더 설정됨]`;

    m = t.match(/^Apply this authentication to all (\d+) custom HTTP servers \((.+)\)$/i);
    if (m) return `이 인증을 ${m[1]}개 커스텀 HTTP 서버 전체에 일괄 적용 (${m[2]})`;

    m = t.match(/^Connected \((\d+) tools available\)$/i);
    if (m) return `연결됨 (사용 가능한 도구 ${m[1]}개)`;

    m = t.match(/^Added\s+"(.+)",\s*which requires authentication\.\s*Enter your token or complete OAuth below\.$/i);
    if (m) return `"${m[1]}" 서버를 추가했습니다. 인증이 필요하므로 아래에서 토큰을 입력하거나 OAuth 인증을 완료하세요.`;

    m = t.match(
      /^Auto-filled form for\s+"(.+)"\.\s*Review settings or authentication below,\s*then click Save & Connect Server\.$/i
    );
    if (m) {
      return `"${m[1]}" 서버 폼을 자동으로 채웠습니다. 아래에서 설정 또는 인증을 확인한 뒤 [서버 저장 및 연결]을 클릭하세요.`;
    }

    m = t.match(/^OAuth authentication completed for\s+"(.+)"\.$/i);
    if (m) return `"${m[1]}" 서버의 OAuth 인증이 완료되었습니다.`;

    m = t.match(/^Disconnected OAuth session for\s+"(.+)"\.$/i);
    if (m) return `"${m[1]}" 서버의 OAuth 세션 연결을 해제했습니다.`;

    m = t.match(/^Edit settings & authentication for\s+"(.+)"$/i);
    if (m) return `"${m[1]}" 설정 및 인증 수정`;

    m = t.match(/^Configure Bearer token,\s*API Key,\s*or OAuth for\s+"(.+)"$/i);
    if (m) return `"${m[1]}" Bearer 토큰, API Key 또는 OAuth 설정`;

    m = t.match(/^Configure authentication for\s+"(.+)"$/i);
    if (m) return `"${m[1]}" 인증 설정`;

    m = t.match(/^Edit settings for\s+"(.+)"$/i);
    if (m) return `"${m[1]}" 설정 수정`;

    // Antigravity Custom MCP Server Manager v1.4.0 dynamic patterns
    m = t.match(/^HTTP\s+(.+?)\s+\[🔗 OAuth Connected\]$/i);
    if (m) return `HTTP ${m[1]}  [🔗 OAuth 연결됨]`;

    m = t.match(/^HTTP\s+(.+?)\s+\[🔗 OAuth\]$/i);
    if (m) return `HTTP ${m[1]}  [🔗 OAuth]`;

    m = t.match(/^●\s*OAuth Connected\s*\((.+)\)$/i);
    if (m) return `● OAuth 연결됨 (${m[1]})`;

    m = t.match(/^🔗\s*OAuth Ready\s*—\s*Sign in to\s+"(.+)"\s+in your browser\.$/i);
    if (m) return `🔗 OAuth 준비됨 — 브라우저에서 "${m[1]}"에 로그인하세요.`;

    m = t.match(/^🔗\s*Connect\s+(.+?)\s*↗$/i);
    if (m) return `🔗 ${m[1]} 연결 ↗`;

    m = t.match(/^Connect\s+(.+?)\s*↗$/i);
    if (m) return `${m[1]} 연결 ↗`;

    m = t.match(/^Connect\s+(.+)$/i);
    if (m) return `${m[1]} 연결`;

    m = t.match(
      /^Antigravity uses browser OAuth authentication to interact with the\s+"(.+)"\s+MCP server\.?\s*Click Connect below to sign in with your account and authorize access\.$/i
    );
    if (m) {
      return `Antigravity는 브라우저 OAuth 인증을 사용하여 "${m[1]}" MCP 서버와 연동합니다. 아래 연결 버튼을 클릭해 계정으로 로그인하고 접근 권한을 승인하세요.`;
    }

    m = t.match(/^OAuth sign-in window is ready for\s+"(.+)"\.$/i);
    if (m) return `"${m[1]}" 서버의 OAuth 로그인 창이 준비되었습니다.`;

    m = t.match(/^Disconnected OAuth for\s+"(.+)"\.$/i);
    if (m) return `"${m[1]}" 서버의 OAuth 연결을 해제했습니다.`;

    m = t.match(/^Auto-filled form for\s+"(.+)"\.\s*Review OAuth \/ connection settings below\.$/i);
    if (m) return `"${m[1]}" 서버 폼을 자동으로 채웠습니다. 아래에서 OAuth 및 연결 설정을 확인하세요.`;

    m = t.match(/^Loaded preset\s+"(.+)"\.$/i);
    if (m) {
      const inner = translateStaticUiSync(m[1]) || m[1];
      return `"${inner}" 프리셋을 불러왔습니다.`;
    }

    // Thinking / Worked duration headers
    m = t.match(/^Thought for\s+(.+)$/i);
    if (m) return `${formatDurationKo(m[1])} 동안 생각함`;

    m = t.match(/^Thinking for\s+(.+)$/i);
    if (m) return `${formatDurationKo(m[1])} 동안 생각하는 중`;

    m = t.match(/^Worked for\s+(.+)$/i);
    if (m) return `${formatDurationKo(m[1])} 동안 작업함`;

    m = t.match(/^Working for\s+(.+)$/i);
    if (m) return `${formatDurationKo(m[1])} 동안 작업 중`;

    // Relative time in sidebar/history
    if (t.toLowerCase() === 'now' || t.toLowerCase() === 'just now') return '방금';
    if (t.toLowerCase() === 'updated just now') return '방금 업데이트됨';
    m = t.match(/^Updated\s+(\d+)\s*s(?:ec(?:ond)?s?)?\s+ago$/i);
    if (m) return `${m[1]}초 전 업데이트됨`;
    m = t.match(/^Updated\s+(\d+)\s*m(?:in(?:ute)?s?)?\s+ago$/i);
    if (m) return `${m[1]}분 전 업데이트됨`;
    m = t.match(/^Updated\s+(\d+)\s*h(?:ours?|r)?\s+ago$/i);
    if (m) return `${m[1]}시간 전 업데이트됨`;
    m = t.match(/^Updated\s+(\d+)\s*d(?:ays?)?\s+ago$/i);
    if (m) return `${m[1]}일 전 업데이트됨`;
    m = t.match(/^Remove\s+(.+?)\s+from your instances\?$/i);
    if (m) return `인스턴스 목록에서 ${m[1]} 항목을 제거하시겠습니까?`;
    m = t.match(/^Last active[:\s]+(.+)$/i);
    if (m) {
      const inner = translateStaticUiSync(m[1]) || m[1];
      return `마지막 활동: ${inner}`;
    }
    m = t.match(/^Version\s+([0-9A-Za-z._-]+)$/i);
    if (m) return `버전 ${m[1]}`;
    m = t.match(/^(\d+)\s*s$/i);
    if (m) return `${m[1]}초`;
    m = t.match(/^(\d+)\s*m$/i);
    if (m) return `${m[1]}분`;
    m = t.match(/^(\d+)\s*h$/i);
    if (m) return `${m[1]}시간`;
    m = t.match(/^(\d+)\s*d$/i);
    if (m) return `${m[1]}일`;
    m = t.match(/^(\d+)\s*w$/i);
    if (m) return `${m[1]}주`;
    m = t.match(/^(\d+)\s*s(?:ec(?:ond)?s?)?\s+ago$/i);
    if (m) return `${m[1]}초 전`;
    m = t.match(/^(\d+)\s*m(?:in(?:ute)?s?)?\s+ago$/i);
    if (m) return `${m[1]}분 전`;
    m = t.match(/^(\d+)\s*h(?:ours?|r)?\s+ago$/i);
    if (m) return `${m[1]}시간 전`;
    m = t.match(/^(\d+)\s*d(?:ays?)?\s+ago$/i);
    if (m) return `${m[1]}일 전`;
    m = t.match(/^(\d+)\s*w(?:eeks?|k)?\s+ago$/i);
    if (m) return `${m[1]}주 전`;
    m = t.match(/^(\d+)\s*mo(?:nths?)?\s+ago$/i);
    if (m) return `${m[1]}개월 전`;

    // File count / message count
    m = t.match(/^(\d+)\s+files?\s+changed$/i);
    if (m) return `파일 ${m[1]}개 변경됨`;

    m = t.match(/^Load older messages,\s*showing\s+(\d+)\s+of\s+(\d+)$/i);
    if (m) return `이전 메시지 불러오기 (${m[2]}개 중 ${m[1]}개 표시)`;

    // Multi-clause tool group summary (e.g. "Explored files, ran commands, edited files")
    if (t.includes(',')) {
      const parts = t.split(',').map((p) => p.trim());
      const translatedParts = parts.map((p) => translateToolClause(p));
      if (translatedParts.every((tp) => tp !== null)) {
        return translatedParts.join(', ');
      }
    }

    const singleTool = translateToolClause(t);
    if (singleTool) return singleTool;

    return null;
  }
