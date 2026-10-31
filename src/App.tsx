import { Route, Routes } from 'react-router'
import MainPage from './pages/MainPage'
import ExamplePage from './examples/ExamplePage'
import Home from './pages/Home'
import GrowthJourney from './pages/GrowthJourney'
import Footprints from './pages/Footprints'


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



      {/* 예시 페이지 */}
      <Route path='/example' element={<ExamplePage />}></Route>
      
    </Routes>

  )
}

export default App
