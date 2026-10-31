import { Outlet } from 'react-router'
import Sidebar from '../components/Sidebar'



function MainPage() {
    return (


        // 화면 전체
        <div className='min-h-screen bg-[#F8F9FC] text-[#111827] md:flex'>
            
            {/* 사이드바 */}
            <Sidebar />

            <main className='mx-auto min-w-0 max-w-[1400px] flex-1 p-4 sm:p-6 lg:p-8'>
                
                {/* 자식 페이지 표시 */}
                <Outlet />
            </main>



        </div>



    )
}

export default MainPage