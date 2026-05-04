import DefaultTheme from 'vitepress/theme-without-fonts'
import type { Theme } from 'vitepress'
import { useRoute } from 'vitepress'
import { theme, useOpenapi } from 'vitepress-openapi/client'
import { nextTick, onMounted, watch } from 'vue'
import mediumZoom from 'medium-zoom'
import 'vitepress-openapi/dist/style.css'
import './custom.css'
import spec from '../../public/openapi.json'
import Layout from './Layout.vue'
import BlogIndex from './BlogIndex.vue'
import BlogPost from './BlogPost.vue'
import StackDiagram from './StackDiagram.vue'
import ArchDiagram from './ArchDiagram.vue'
import ArchDiagramFull from './ArchDiagramFull.vue'
import DashboardArchDiagram from './DashboardArchDiagram.vue'
import DecisionTree from './DecisionTree.vue'
import ScopeDiagram from './ScopeDiagram.vue'
import DeploymentDiagram from './DeploymentDiagram.vue'
import NetworkTopology from './NetworkTopology.vue'
import EventFlowDiagram from './EventFlowDiagram.vue'
import DeliveryStateMachine from './DeliveryStateMachine.vue'
import NetworkZones from './NetworkZones.vue'
import AdoptionLadder from './AdoptionLadder.vue'
import CostCalculator from './CostCalculator.vue'
import BlastRadiusCalculator from './BlastRadiusCalculator.vue'

export default {
  extends: DefaultTheme,
  Layout,
  async enhanceApp({ app }) {
    useOpenapi({ spec })
    theme.enhanceApp({ app })
    app.component('BlogIndex', BlogIndex)
    app.component('BlogPost', BlogPost)
    app.component('StackDiagram', StackDiagram)
    app.component('ArchDiagram', ArchDiagram)
    app.component('ArchDiagramFull', ArchDiagramFull)
    app.component('DashboardArchDiagram', DashboardArchDiagram)
    app.component('DecisionTree', DecisionTree)
    app.component('ScopeDiagram', ScopeDiagram)
    app.component('DeploymentDiagram', DeploymentDiagram)
    app.component('NetworkTopology', NetworkTopology)
    app.component('EventFlowDiagram', EventFlowDiagram)
    app.component('DeliveryStateMachine', DeliveryStateMachine)
    app.component('NetworkZones', NetworkZones)
    app.component('AdoptionLadder', AdoptionLadder)
    app.component('CostCalculator', CostCalculator)
    app.component('BlastRadiusCalculator', BlastRadiusCalculator)
  },
  setup() {
    const route = useRoute()
    onMounted(() => {
      // Click-to-zoom on all content images
      const initZoom = () => {
        mediumZoom('.vp-doc img:not(.no-zoom)', {
          background: 'var(--vp-c-bg)',
        })
      }
      initZoom()
      watch(
        () => route.path,
        () => {
          if (document.startViewTransition) {
            document.startViewTransition(() => nextTick())
          }
          nextTick(initZoom)
        }
      )
    })
  }
} satisfies Theme
