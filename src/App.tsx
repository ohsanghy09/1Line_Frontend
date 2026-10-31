import { Route, Routes } from 'react-router'
import MainPage from './pages/MainPage'
import ExamplePage from './examples/ExamplePage'


function App() {

  return (

    <Routes>

      {/* 메인 페이지 */}
      <Route path='/' element={<MainPage />}></Route>

      {/* 예시 페이지 */}
      <Route path='/example' element={<ExamplePage />}></Route>
      
    </Routes>

  )
}

export default App
