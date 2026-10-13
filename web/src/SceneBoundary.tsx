import { Component, type ReactNode } from 'react'

/** Keeps the page (name, links, rooms) usable if the 3D scene throws. */
export class SceneBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[scene]', error)
  }

  render() {
    if (this.state.error)
      return (
        <div className="loader">
          <span>The 3D scene failed to load ({this.state.error.message}). Try reloading the page.</span>
        </div>
      )
    return this.props.children
  }
}
