// 네비게이션 링크 사용하기 위한 라우터 라이브러리
import { NavLink } from "react-router"
// 원본 HTML과 같은 Lucide 아이콘
import { Footprints, House, Settings, Sparkles, TrendingUp } from "lucide-react"

function Sidebar() {
    return (
        // 본문 옆에 사이드바 태그
        <aside className="w-full md:w-[240px] bg-brand-surface border-r border-brand-border shrink-0 flex flex-col justify-between z-20 md:sticky md:top-0 md:h-screen">
            {/* 상단 영역: 브랜드와 메뉴를 하나로 묶어 원본처럼 함께 배치 */}
            <div>
                {/* 브랜드 헤더: 내부 여백과 아래쪽 경계선 */}
                <div className="p-5 flex items-center justify-between border-b border-brand-border/60">
                    {/* 브랜드 링크: 로고와 이름을 누르면 홈으로 이동 */}
                    <NavLink to="/" className="flex items-center space-x-2.5 cursor-pointer">
                        {/* 브랜드 아이콘: 36px 배경 안의 20px Sparkles */}
                        <div className="w-9 h-9 rounded-xl bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                            <Sparkles className="w-5 h-5" aria-hidden="true" />
                        </div>
                        <div>
                            <h1 className="font-bold text-base tracking-tight text-brand-text leading-tight">Growth Archive</h1>
                            <p className="text-[11px] text-brand-muted font-medium">Personal AI Knowledge</p>
                        </div>
                    </NavLink>
                </div>

                {/* 네비게이션 이동 메뉴 묶는 태그 */}
                <nav aria-label="주 메뉴" className="p-3 space-y-1">
                    {/* end는 현재 주소가 여기서 끝나야 이 메뉴를 선택 표시 */}
                    {/* 홈 링크: 아이콘과 메뉴 이름 */}
                    <NavLink
                        to="/"
                        end
                        // 리액트 라우터가 isActive 인자 값을 제공, 그걸 화살표 함수 인자로 사용해서 조건문 작성.
                        className={({ isActive }) =>
                            isActive
                                ? 'w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all text-brand-primary bg-brand-primarySoft border-l-4 border-brand-primary'
                                : 'w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all text-brand-muted hover:bg-slate-50 hover:text-brand-text'
                        }>
                        <House className="w-4 h-4" aria-hidden="true" />
                        <span>홈</span>
                    </NavLink>

                    {/* 성장일지 섹션 제목: 바깥 여백과 글자 스타일을 원본처럼 분리 */}
                    <div className="pt-3 pb-1 px-3">
                        <span className="text-[11px] font-semibold tracking-wider text-brand-muted uppercase">나의 성장일지</span>
                    </div>

                    {/* GrowthJourney 링크 */}
                    <NavLink
                        to="/journey"
                        // 리액트 라우터가 isActive 인자 값을 제공, 그걸 화살표 함수 인자로 사용해서 조건문 작성.
                        className={({ isActive }) =>
                            isActive
                                ? 'w-full flex items-center space-x-3 px-3.5 py-2 rounded-xl text-sm font-medium transition-all text-brand-primary bg-brand-primarySoft border-l-4 border-brand-primary'
                                : 'w-full flex items-center space-x-3 px-3.5 py-2 rounded-xl text-sm font-medium transition-all text-brand-muted hover:bg-slate-50 hover:text-brand-text'
                        }>
                        <TrendingUp className="w-4 h-4" aria-hidden="true" />
                        <span>Growth Journey</span>
                    </NavLink>

                    {/* 아카이브 섹션 제목 */}
                    <div className="pt-3 pb-1 px-3">
                        <span className="text-[11px] font-semibold tracking-wider text-brand-muted uppercase">아카이브</span>
                    </div>

                    {/* 나의 발자국 링크: 상세 경로에서도 활성 상태를 유지 */}
                    <NavLink
                        to="/archive"
                        // 리액트 라우터가 isActive 인자 값을 제공, 그걸 화살표 함수 인자로 사용해서 조건문 작성.
                        className={({ isActive }) =>
                            isActive
                                ? 'w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all text-brand-primary bg-brand-primarySoft border-l-4 border-brand-primary'
                                : 'w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all text-brand-muted hover:bg-slate-50 hover:text-brand-text'
                        }>
                        <Footprints className="w-4 h-4" aria-hidden="true" />
                        <span>나의 발자국</span>
                    </NavLink>
                </nav>
            </div>

            {/* 하단 사용자 영역: 왼쪽 프로필과 오른쪽 설정 아이콘 */}
            <div className="p-3.5 m-3 rounded-2xl bg-slate-50 border border-brand-border flex items-center justify-between">
                {/* 프로필: 아바타와 사용자 정보 */}
                <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-full bg-linear-to-tr from-brand-primary to-brand-secondary text-white font-semibold text-xs flex items-center justify-center">
                        김성장
                    </div>
                    <div>
                        <p className="text-xs font-semibold text-brand-text">김성장 님</p>
                        {/* 원본의 시각 비교용 예시 문구: 데이터 연동 시 실제 활동 개수로 교체 */}
                        <p className="text-[10px] text-brand-muted">활동 6개 기록 중</p>
                    </div>
                </div>
                {/* 설정 아이콘: 원본에 별도의 설정 화면이나 클릭 동작은 없음 */}
                <Settings className="w-4 h-4 text-brand-muted cursor-pointer hover:text-brand-text" aria-hidden="true" />
            </div>
        </aside>
    )
}

export default Sidebar
