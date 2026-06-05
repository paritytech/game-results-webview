import { forwardRef, type ReactNode } from 'react'

interface PhoneFrameProps {
  children?: ReactNode
}

const PhoneFrame = forwardRef<HTMLDivElement, PhoneFrameProps>(function PhoneFrame(
  { children },
  ref
) {
  return (
    <div className="phone-frame" ref={ref}>
      <div className="phone-status-bar">
        <span>11:59</span>
        <span className="phone-notch" />
        <span className="phone-status-icons">
          <span className="bar-dot" />
          <span className="bar-dot small" />
          <span className="bar-pill" />
        </span>
      </div>
      {children}
    </div>
  )
})

export default PhoneFrame
