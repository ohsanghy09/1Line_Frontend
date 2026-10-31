import { Outlet } from 'react-router'
import Sidebar from '../components/Sidebar'



function MainPage() {
    return (


        // 화면 전체
        <div className="bg-brand-bg text-brand-text font-sans antialiased min-h-screen flex flex-col md:flex-row overflow-x-clip">
            
            {/* 사이드바 */}
            <Sidebar />

            <main className='flex-1 min-w-0 max-w-[1400px] mx-auto p-4 sm:p-6 lg:p-8 flex flex-col gap-6'>
                
                {/* 자식 페이지 표시 */}
                <Outlet />
            </main>



        </div>



    )
}

export default MainPage
