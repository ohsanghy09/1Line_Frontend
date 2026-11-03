import { Route, Routes } from 'react-router'
import MainPage from './pages/MainPage'
import Home from './pages/Home'
import GrowthJourney from './pages/GrowthJourney'
import Footprints from './pages/Footprints'
import ExamplePage from './examples/ExamplePage'


function App() {

  return (

    <Routes>

      {/* 메인 페이지, 자식 페이지 생성 */}
      <Route path='/' element={<MainPage />}>

        {/* Home 페이지를 기본 자식 경로로 설정 */}
        <Route index element={<Home />}/> 
        <Route path='/journey' element={<GrowthJourney />} />
        <Route path='/archive' element={<Footprints />} />

      </Route>

      {/* 실제 채팅 컴포넌트와 응답 데이터를 확인하는 독립 페이지 */}
      <Route path='/example' element={<ExamplePage />} />
      
    </Routes>

  )
}

export default App
