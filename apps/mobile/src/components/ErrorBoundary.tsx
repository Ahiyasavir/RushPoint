import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { reportError } from '../services/telemetry';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * App-wide crash guard for the team app. A render error anywhere in the screen
 * tree would otherwise leave a blank screen with no way back mid-race. We catch
 * it, log it (a Sentry hook would slot into componentDidCatch for production),
 * and offer a "try again" that resets the boundary. Uses raw react-native
 * primitives only — no theme/i18n context or component-kit imports — so the
 * fallback renders even if one of those is the thing that failed.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportError(error, { componentStack: info.componentStack, boundary: 'mobile-root' });
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <View
          style={{
            flex: 1,
            backgroundColor: '#050508',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <Text style={{ fontSize: 40, marginBottom: 12 }}>⚠️</Text>
          <Text
            style={{
              color: '#ffffff',
              fontSize: 20,
              fontWeight: '700',
              marginBottom: 8,
              textAlign: 'center',
            }}
          >
            משהו השתבש
          </Text>
          <Text
            style={{
              color: '#a1a1aa',
              fontSize: 14,
              textAlign: 'center',
              marginBottom: 24,
              maxWidth: 320,
            }}
          >
            האפליקציה נתקלה בשגיאה. הנתונים שלכם בטוחים — נסו שוב.{'\n'}
            Something went wrong — your progress is safe. Tap to retry.
          </Text>
          <Pressable
            onPress={this.reset}
            style={{
              backgroundColor: 'rgba(57, 255, 20, 0.12)',
              borderColor: 'rgba(57, 255, 20, 0.3)',
              borderWidth: 1,
              borderRadius: 12,
              paddingHorizontal: 24,
              paddingVertical: 12,
            }}
          >
            <Text style={{ color: '#39ff14', fontSize: 15, fontWeight: '600' }}>
              נסו שוב · Try again
            </Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}
